Below is a complete transactional-outbox implementation in Go using PostgreSQL and Elasticsearch directly — no Debezium/CDC.

It demonstrates:

- Updating the relational entity and inserting the outbox event in the same DB transaction.
- A polling outbox worker.
- `FOR UPDATE SKIP LOCKED` claiming for distributed workers.
- Visibility timeout / lock expiration for crashed workers.
- Exponential backoff with jitter.
- Strict deterministic idempotency keys.
- Elasticsearch-side idempotent update script.
- Protection against overlapping local worker loops using `atomic.Bool`.

---

## PostgreSQL schema

```sql
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents BIGINT NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY,

    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,

    -- Globally stable idempotency key.
    -- Example: product:8d9...:version:12:event:product.indexed.v1
    idempotency_key TEXT NOT NULL UNIQUE,

    payload JSONB NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),

    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 20,

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    locked_by TEXT,
    locked_until TIMESTAMPTZ,

    last_error TEXT,

    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_poll
ON outbox_events (
    status,
    next_attempt_at,
    locked_until,
    created_at
);
```

---

## Go implementation

```go
package main

import (
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	mrand "math/rand"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const Schema = `
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents BIGINT NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY,

    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,

    idempotency_key TEXT NOT NULL UNIQUE,

    payload JSONB NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),

    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 20,

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    locked_by TEXT,
    locked_until TIMESTAMPTZ,

    last_error TEXT,

    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_poll
ON outbox_events (
    status,
    next_attempt_at,
    locked_until,
    created_at
);
`

const ProductIndexedEventV1 = "product.indexed.v1"

type ProductIndexedPayload struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	PriceCents  int64     `json:"price_cents"`
	Version     int64     `json:"version"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type OutboxEvent struct {
	ID             string
	AggregateType  string
	AggregateID    string
	EventType       string
	Payload         []byte
	IdempotencyKey string
	Attempts       int
	MaxAttempts    int
}

type ProductRepository struct {
	db *pgxpool.Pool
}

func NewProductRepository(db *pgxpool.Pool) *ProductRepository {
	return &ProductRepository{db: db}
}

// UpdateProduct performs the local DB mutation and inserts the outbox event
// in the same PostgreSQL transaction.
func (r *ProductRepository) UpdateProduct(
	ctx context.Context,
	productID string,
	name string,
	description string,
	priceCents int64,
) error {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{
		IsoLevel: pgx.ReadCommitted,
	})
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var version int64
	var updatedAt time.Time

	err = tx.QueryRow(ctx, `
		UPDATE products
		SET
			name = $1,
			description = $2,
			price_cents = $3,
			version = version + 1,
			updated_at = now()
		WHERE id = $4
		RETURNING version, updated_at
	`, name, description, priceCents, productID).Scan(&version, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("product %s not found", productID)
	}
	if err != nil {
		return err
	}

	payload := ProductIndexedPayload{
		ID:          productID,
		Name:        name,
		Description: description,
		PriceCents:  priceCents,
		Version:     version,
		UpdatedAt:   updatedAt,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	eventID, err := newUUIDv4()
	if err != nil {
		return err
	}

	// Stable, strict idempotency key.
	//
	// For a given aggregate version and event type, this value is deterministic
	// and unique. It is protected by a UNIQUE constraint in PostgreSQL and is
	// also sent to Elasticsearch.
	idempotencyKey := fmt.Sprintf(
		"product:%s:version:%d:event:%s",
		productID,
		version,
		ProductIndexedEventV1,
	)

	_, err = tx.Exec(ctx, `
		INSERT INTO outbox_events (
			id,
			aggregate_type,
			aggregate_id,
			event_type,
			idempotency_key,
			payload
		)
		VALUES ($1, 'product', $2, $3, $4, $5)
	`, eventID, productID, ProductIndexedEventV1, idempotencyKey, payloadBytes)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

type SearchIndexer interface {
	UpsertProduct(ctx context.Context, payload ProductIndexedPayload, idempotencyKey string) error
}

type ElasticsearchClient struct {
	baseURL      *url.URL
	httpClient   *http.Client
	apiKey       string
	productIndex string
}

func NewElasticsearchClient(rawURL string, apiKey string, productIndex string) (*ElasticsearchClient, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if productIndex == "" {
		productIndex = "products"
	}

	return &ElasticsearchClient{
		baseURL: u,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		apiKey:       apiKey,
		productIndex: productIndex,
	}, nil
}

// productUpsertScript makes Elasticsearch delivery idempotent.
//
// Behavior:
//
//  1. If this exact idempotency key was already applied, noop.
//  2. If the incoming entity version is newer than the indexed version,
//     apply the document and remember the idempotency key.
//  3. If the event is stale, noop.
//
// This protects against:
//
//   - worker crash after successful ES delivery but before marking outbox row delivered
//   - multiple workers redelivering the same event after lock expiration
//   - older product events arriving after newer ones
//
// For very high write volumes, a separate idempotency index can be used instead
// of storing all processed keys on the document. This version keeps keys forever
// to demonstrate strict idempotency.
const productUpsertScript = `
if (ctx._source.processed_idempotency_keys == null) {
    ctx._source.processed_idempotency_keys = new ArrayList();
}

if (ctx._source.processed_idempotency_keys.contains(params.idempotency_key)) {
    ctx.op = 'noop';
    return;
}

long currentVersion = -1;
if (ctx._source.entity_version != null) {
    currentVersion = ((Number) ctx._source.entity_version).longValue();
}

long incomingVersion = ((Number) params.entity_version).longValue();

if (incomingVersion > currentVersion) {
    ctx._source.processed_idempotency_keys.add(params.idempotency_key);

    for (entry in params.doc.entrySet()) {
        ctx._source[entry.getKey()] = entry.getValue();
    }

    ctx._source.entity_version = incomingVersion;
    ctx._source.last_idempotency_key = params.idempotency_key;
} else {
    ctx.op = 'noop';
}
`

func (c *ElasticsearchClient) UpsertProduct(
	ctx context.Context,
	payload ProductIndexedPayload,
	idempotencyKey string,
) error {
	doc := map[string]any{
		"id":          payload.ID,
		"name":        payload.Name,
		"description": payload.Description,
		"price_cents": payload.PriceCents,
		"updated_at":  payload.UpdatedAt.Format(time.RFC3339Nano),
	}

	body := map[string]any{
		"scripted_upsert": true,
		"script": map[string]any{
			"lang":   "painless",
			"source": productUpsertScript,
			"params": map[string]any{
				"idempotency_key": idempotencyKey,
				"entity_version":  payload.Version,
				"doc":             doc,
			},
		},
		"upsert": map[string]any{},
	}

	b, err := json.Marshal(body)
	if err != nil {
		return err
	}

	u := *c.baseURL
	u.Path = strings.TrimRight(u.Path, "/") +
		"/" + url.PathEscape(c.productIndex) +
		"/_update/" + url.PathEscape(payload.ID)

	q := u.Query()
	q.Set("retry_on_conflict", "5")
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(b))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")

	if c.apiKey != "" {
		req.Header.Set("Authorization", "ApiKey "+c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))

	// Retryable Elasticsearch responses.
	if resp.StatusCode == http.StatusTooManyRequests ||
		resp.StatusCode == http.StatusRequestTimeout ||
		resp.StatusCode == http.StatusConflict ||
		resp.StatusCode >= 500 {
		return &DeliveryError{
			Permanent: false,
			Message:   fmt.Sprintf("elasticsearch retryable status=%d body=%s", resp.StatusCode, string(errBody)),
		}
	}

	return &DeliveryError{
		Permanent: true,
		Message:   fmt.Sprintf("elasticsearch permanent status=%d body=%s", resp.StatusCode, string(errBody)),
	}
}

type DeliveryError struct {
	Permanent bool
	Message   string
}

func (e *DeliveryError) Error() string {
	return e.Message
}

type Backoff struct {
	base time.Duration
	max  time.Duration

	mu  sync.Mutex
	rnd *mrand.Rand
}

func NewBackoff(base time.Duration, max time.Duration) *Backoff {
	return &Backoff{
		base: base,
		max:  max,
		rnd:  mrand.New(mrand.NewSource(time.Now().UnixNano())),
	}
}

// Delay returns exponential backoff with equal jitter.
//
// failedAttempts is 1 for the first failed delivery, 2 for the second, etc.
func (b *Backoff) Delay(failedAttempts int) time.Duration {
	if failedAttempts <= 0 {
		failedAttempts = 1
	}

	capDelay := b.base
	for i := 1; i < failedAttempts; i++ {
		capDelay *= 2
		if capDelay >= b.max {
			capDelay = b.max
			break
		}
	}

	if capDelay <= 0 {
		return b.base
	}

	half := capDelay / 2
	if half <= 0 {
		return capDelay
	}

	b.mu.Lock()
	jitter := time.Duration(b.rnd.Int63n(int64(capDelay - half)))
	b.mu.Unlock()

	return half + jitter
}

type OutboxWorkerConfig struct {
	WorkerID        string
	PollInterval    time.Duration
	BatchSize       int
	LockTimeout     time.Duration
	DeliveryTimeout time.Duration
	BackoffBase     time.Duration
	BackoffMax      time.Duration
}

func (c *OutboxWorkerConfig) withDefaults() OutboxWorkerConfig {
	out := *c

	if out.WorkerID == "" {
		id, err := newUUIDv4()
		if err != nil {
			out.WorkerID = fmt.Sprintf("worker-%d", time.Now().UnixNano())
		} else {
			out.WorkerID = "worker-" + id
		}
	}
	if out.PollInterval <= 0 {
		out.PollInterval = 1 * time.Second
	}
	if out.BatchSize <= 0 {
		out.BatchSize = 100
	}
	if out.LockTimeout <= 0 {
		out.LockTimeout = 2 * time.Minute
	}
	if out.DeliveryTimeout <= 0 {
		out.DeliveryTimeout = 15 * time.Second
	}
	if out.BackoffBase <= 0 {
		out.BackoffBase = 500 * time.Millisecond
	}
	if out.BackoffMax <= 0 {
		out.BackoffMax = 5 * time.Minute
	}

	return out
}

type OutboxWorker struct {
	db      *pgxpool.Pool
	indexer SearchIndexer
	cfg     OutboxWorkerConfig
	backoff *Backoff

	// Prevents overlapping worker execution loops in this process.
	//
	// This is separate from distributed locking. Distributed duplicate claiming
	// is prevented by PostgreSQL row locks plus FOR UPDATE SKIP LOCKED.
	loopRunning atomic.Bool
}

func NewOutboxWorker(
	db *pgxpool.Pool,
	indexer SearchIndexer,
	cfg OutboxWorkerConfig,
) *OutboxWorker {
	cfg = cfg.withDefaults()

	return &OutboxWorker{
		db:      db,
		indexer: indexer,
		cfg:     cfg,
		backoff: NewBackoff(cfg.BackoffBase, cfg.BackoffMax),
	}
}

func (w *OutboxWorker) Run(ctx context.Context) error {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	w.trigger(ctx)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case <-ticker.C:
			w.trigger(ctx)
		}
	}
}

// trigger starts one drain loop if none is currently running.
//
// If the previous polling run is still processing events when the next ticker
// fires, this method skips the new run. That explicitly prevents overlapping
// local execution loops.
func (w *OutboxWorker) trigger(ctx context.Context) {
	if !w.loopRunning.CompareAndSwap(false, true) {
		log.Printf("outbox worker %s: previous loop still running; skipping tick", w.cfg.WorkerID)
		return
	}

	go func() {
		defer w.loopRunning.Store(false)

		if err := w.drain(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("outbox worker %s: drain error: %v", w.cfg.WorkerID, err)
		}
	}()
}

// drain keeps processing while full batches are available.
func (w *OutboxWorker) drain(ctx context.Context) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		n, err := w.processBatch(ctx)
		if err != nil {
			return err
		}

		if n < w.cfg.BatchSize {
			return nil
		}
	}
}

func (w *OutboxWorker) processBatch(ctx context.Context) (int, error) {
	events, err := w.claimBatch(ctx)
	if err != nil {
		return 0, err
	}

	for _, evt := range events {
		if ctx.Err() != nil {
			return len(events), ctx.Err()
		}

		deliveryCtx, cancel := context.WithTimeout(ctx, w.cfg.DeliveryTimeout)
		err := w.deliver(deliveryCtx, evt)
		cancel()

		if err == nil {
			if markErr := w.markDelivered(ctx, evt); markErr != nil {
				log.Printf(
					"outbox worker %s: delivered event id=%s key=%s but failed to mark delivered: %v",
					w.cfg.WorkerID,
					evt.ID,
					evt.IdempotencyKey,
					markErr,
				)
			}
			continue
		}

		permanent := false
		var deliveryErr *DeliveryError
		if errors.As(err, &deliveryErr) {
			permanent = deliveryErr.Permanent
		}

		if markErr := w.markFailed(ctx, evt, err, permanent); markErr != nil {
			log.Printf(
				"outbox worker %s: failed event id=%s key=%s and failed to persist failure: delivery_err=%v mark_err=%v",
				w.cfg.WorkerID,
				evt.ID,
				evt.IdempotencyKey,
				err,
				markErr,
			)
		}
	}

	return len(events), nil
}

// claimBatch atomically claims available rows.
//
// Important properties:
//
//   - FOR UPDATE SKIP LOCKED prevents multiple distributed workers from claiming
//     the same event concurrently.
//   - locked_until is a visibility timeout. If a worker crashes after claiming
//     but before marking delivered/failed, another worker may reclaim the event
//     later.
//   - Redelivery after a crash is safe because delivery to Elasticsearch is
//     idempotent by idempotency_key and entity version.
func (w *OutboxWorker) claimBatch(ctx context.Context) ([]OutboxEvent, error) {
	tx, err := w.db.BeginTx(ctx, pgx.TxOptions{
		IsoLevel: pgx.ReadCommitted,
	})
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	lockSeconds := w.cfg.LockTimeout.Seconds()

	rows, err := tx.Query(ctx, `
		WITH picked AS (
			SELECT id
			FROM outbox_events
			WHERE
				status IN ('pending', 'processing')
				AND attempts < max_attempts
				AND next_attempt_at <= now()
				AND (
					status = 'pending'
					OR locked_until IS NULL
					OR locked_until < now()
				)
			ORDER BY next_attempt_at ASC, created_at ASC
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE outbox_events o
		SET
			status = 'processing',
			locked_by = $2,
			locked_until = now() + ($3::double precision * interval '1 second'),
			updated_at = now()
		FROM picked
		WHERE o.id = picked.id
		RETURNING
			o.id::text,
			o.aggregate_type,
			o.aggregate_id,
			o.event_type,
			o.payload,
			o.idempotency_key,
			o.attempts,
			o.max_attempts
	`, w.cfg.BatchSize, w.cfg.WorkerID, lockSeconds)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []OutboxEvent

	for rows.Next() {
		var evt OutboxEvent
		if err := rows.Scan(
			&evt.ID,
			&evt.AggregateType,
			&evt.AggregateID,
			&evt.EventType,
			&evt.Payload,
			&evt.IdempotencyKey,
			&evt.Attempts,
			&evt.MaxAttempts,
		); err != nil {
			return nil, err
		}

		events = append(events, evt)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return events, nil
}

func (w *OutboxWorker) deliver(ctx context.Context, evt OutboxEvent) error {
	switch evt.EventType {
	case ProductIndexedEventV1:
		var payload ProductIndexedPayload
		if err := json.Unmarshal(evt.Payload, &payload); err != nil {
			return &DeliveryError{
				Permanent: true,
				Message:   fmt.Sprintf("invalid product payload: %v", err),
			}
		}

		return w.indexer.UpsertProduct(ctx, payload, evt.IdempotencyKey)

	default:
		return &DeliveryError{
			Permanent: true,
			Message:   fmt.Sprintf("unknown event type: %s", evt.EventType),
		}
	}
}

func (w *OutboxWorker) markDelivered(ctx context.Context, evt OutboxEvent) error {
	tag, err := w.db.Exec(ctx, `
		UPDATE outbox_events
		SET
			status = 'delivered',
			delivered_at = now(),
			locked_by = NULL,
			locked_until = NULL,
			last_error = NULL,
			updated_at = now()
		WHERE
			id = $1
			AND idempotency_key = $2
			AND status = 'processing'
			AND locked_by = $3
	`, evt.ID, evt.IdempotencyKey, w.cfg.WorkerID)
	if err != nil {
		return err
	}

	if tag.RowsAffected() == 0 {
		log.Printf(
			"outbox worker %s: event id=%s key=%s was delivered but lock was no longer owned by this worker",
			w.cfg.WorkerID,
			evt.ID,
			evt.IdempotencyKey,
		)
	}

	return nil
}

func (w *OutboxWorker) markFailed(
	ctx context.Context,
	evt OutboxEvent,
	deliveryErr error,
	permanent bool,
) error {
	newAttempts := evt.Attempts + 1

	status := "pending"
	delay := w.backoff.Delay(newAttempts)

	if permanent || newAttempts >= evt.MaxAttempts {
		status = "dead"
		delay = 0
	}

	nextAttemptAt := time.Now().Add(delay)

	tag, err := w.db.Exec(ctx, `
		UPDATE outbox_events
		SET
			status = $4,
			attempts = $5,
			next_attempt_at = $6,
			locked_by = NULL,
			locked_until = NULL,
			last_error = $7,
			updated_at = now()
		WHERE
			id = $1
			AND idempotency_key = $2
			AND status = 'processing'
			AND locked_by = $3
	`, evt.ID, evt.IdempotencyKey, w.cfg.WorkerID, status, newAttempts, nextAttemptAt, truncate(deliveryErr.Error(), 4000))
	if err != nil {
		return err
	}

	if tag.RowsAffected() == 0 {
		log.Printf(
			"outbox worker %s: failed event id=%s key=%s but lock was no longer owned by this worker",
			w.cfg.WorkerID,
			evt.ID,
			evt.IdempotencyKey,
		)
	}

	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func newUUIDv4() (string, error) {
	var b [16]byte
	if _, err := cryptorand.Read(b[:]); err != nil {
		return "", err
	}

	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80

	return fmt.Sprintf(
		"%x-%x-%x-%x-%x",
		b[0:4],
		b[4:6],
		b[6:8],
		b[8:10],
		b[10:16],
	), nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databaseURL := os.Getenv("DATABASE_URL")
	elasticsearchURL := os.Getenv("ELASTICSEARCH_URL")
	elasticsearchAPIKey := os.Getenv("ELASTICSEARCH_API_KEY")

	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if elasticsearchURL == "" {
		log.Fatal("ELASTICSEARCH_URL is required")
	}

	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if os.Getenv("APPLY_SCHEMA") == "1" {
		if _, err := db.Exec(ctx, Schema); err != nil {
			log.Fatal(err)
		}
	}

	es, err := NewElasticsearchClient(elasticsearchURL, elasticsearchAPIKey, "products")
	if err != nil {
		log.Fatal(err)
	}

	worker := NewOutboxWorker(db, es, OutboxWorkerConfig{
		PollInterval:    1 * time.Second,
		BatchSize:       100,
		LockTimeout:     2 * time.Minute,
		DeliveryTimeout: 15 * time.Second,
		BackoffBase:     500 * time.Millisecond,
		BackoffMax:      5 * time.Minute,
	})

	err = worker.Run(ctx)
	if err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}
```

---

## Key correctness points

### 1. Transactional outbox

`UpdateProduct` updates `products` and inserts `outbox_events` inside the same PostgreSQL transaction.

Therefore, either both happen or neither happens.

```go
tx.QueryRow(...)
tx.Exec(`INSERT INTO outbox_events ...`)
tx.Commit(ctx)
```

This avoids the classic dual-write bug where the database update succeeds but the Elasticsearch update event is lost.

---

### 2. Distributed duplicate prevention

Workers claim rows with:

```sql
FOR UPDATE SKIP LOCKED
```

inside a transaction.

That means multiple worker processes can safely poll the same outbox table. PostgreSQL ensures one event row is claimed by only one worker at a time.

---

### 3. Crash recovery

Rows are marked as:

```sql
status = 'processing',
locked_by = $workerID,
locked_until = now() + lock_timeout
```

If a worker crashes after claiming an event, another worker can reclaim it after `locked_until`.

This gives at-least-once delivery.

---

### 4. Idempotent Elasticsearch delivery

The idempotency key is deterministic:

```go
product:<id>:version:<version>:event:product.indexed.v1
```

The Elasticsearch update script:

- noops if the same idempotency key was already processed;
- applies only if the incoming entity version is newer;
- ignores stale events.

This makes retry/redelivery safe.

---

### 5. No overlapping local worker loops

The worker uses:

```go
loopRunning atomic.Bool
```

and:

```go
if !w.loopRunning.CompareAndSwap(false, true) {
    log.Printf("previous loop still running; skipping tick")
    return
}
```

So if polling takes longer than the poll interval, a new local polling loop does not start on top of the old one.

Distributed concurrency is handled separately by PostgreSQL row locks.