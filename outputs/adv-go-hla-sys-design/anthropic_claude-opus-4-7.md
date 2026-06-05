# Transactional Outbox Pattern: PostgreSQL → Elasticsearch Bridge

This solution implements a **dual-write synchronization** mechanism using the **Transactional Outbox Pattern**. The key insight: instead of writing to PostgreSQL and Elasticsearch separately (risking inconsistency), we write the business change AND an outbox event in a **single local transaction**. A background worker then reliably ships outbox rows to Elasticsearch.

## Architecture Overview

```
┌──────────────┐   1 TX    ┌──────────────────┐
│ App Handler  │──────────▶│ entities + outbox│ (Postgres)
└──────────────┘           └────────┬─────────┘
                                    │ poll (FOR UPDATE SKIP LOCKED)
                                    ▼
                           ┌──────────────────┐
                           │  Outbox Worker   │
                           │  - leader lock   │
                           │  - idempotency   │
                           │  - backoff+jitter│
                           └────────┬─────────┘
                                    ▼
                           ┌──────────────────┐
                           │  Elasticsearch   │
                           └──────────────────┘
```

## 1. Schema

```sql
-- Business table
CREATE TABLE entities (
    id          UUID PRIMARY KEY,
    name        TEXT NOT NULL,
    payload     JSONB NOT NULL,
    version     BIGINT NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox table
CREATE TABLE outbox_events (
    id              BIGSERIAL PRIMARY KEY,
    -- Strict idempotency key: stable across retries, unique per logical event
    idempotency_key TEXT NOT NULL UNIQUE,
    aggregate_type  TEXT NOT NULL,          -- e.g. "entity"
    aggregate_id    TEXT NOT NULL,          -- e.g. entity UUID
    event_type      TEXT NOT NULL,          -- "upsert" | "delete"
    payload         JSONB NOT NULL,
    version         BIGINT NOT NULL,        -- monotonic per aggregate
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Worker bookkeeping
    status          TEXT NOT NULL DEFAULT 'pending', -- pending|processing|done|dead
    attempts        INT  NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT
);

CREATE INDEX idx_outbox_dispatch
    ON outbox_events (next_attempt_at)
    WHERE status IN ('pending','processing');

-- Single-leader advisory lock target (one row)
CREATE TABLE outbox_leader (id INT PRIMARY KEY);
INSERT INTO outbox_leader(id) VALUES (1) ON CONFLICT DO NOTHING;
```

Key design choices:
- `idempotency_key UNIQUE` → prevents *enqueueing* duplicates at the source.
- `FOR UPDATE SKIP LOCKED` → enables safe multi-worker dispatch without overlap on the same row.
- PostgreSQL **advisory locks** → ensure only one worker loop runs the polling tick at a time per process *and* optionally cluster-wide.

## 2. Producing Events Transactionally

```go
package outbox

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

type Event struct {
	AggregateType string
	AggregateID   string
	EventType     string
	Payload       any
	Version       int64
}

// Idempotency key is derived deterministically: same (aggregate,version,type)
// will always produce the same key, so retries by the app layer cannot
// double-insert.
func makeIdempotencyKey(e Event) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s|%s|%s|%d", e.AggregateType, e.AggregateID, e.EventType, e.Version)
	return hex.EncodeToString(h.Sum(nil))
}

// EnqueueInTx must be called inside the same *sql.Tx used to mutate the
// business entity. This is what makes the dual-write atomic.
func EnqueueInTx(ctx context.Context, tx *sql.Tx, e Event) error {
	body, err := json.Marshal(e.Payload)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO outbox_events
		    (idempotency_key, aggregate_type, aggregate_id, event_type, payload, version)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, makeIdempotencyKey(e), e.AggregateType, e.AggregateID, e.EventType, body, e.Version)
	return err
}
```

Example call site (in the request handler):

```go
func UpdateEntity(ctx context.Context, db *sql.DB, id string, name string, payload map[string]any) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil { return err }
	defer tx.Rollback()

	var newVersion int64
	err = tx.QueryRowContext(ctx, `
		UPDATE entities
		   SET name=$2, payload=$3, version=version+1, updated_at=now()
		 WHERE id=$1
		RETURNING version
	`, id, name, payload).Scan(&newVersion)
	if err != nil { return err }

	if err := outbox.EnqueueInTx(ctx, tx, outbox.Event{
		AggregateType: "entity",
		AggregateID:   id,
		EventType:     "upsert",
		Payload:       payload,
		Version:       newVersion,
	}); err != nil {
		return err
	}
	return tx.Commit()
}
```

## 3. The Worker — Polling, Idempotency, Backoff, Non-overlapping Loops

```go
package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"math/rand"
	"sync/atomic"
	"time"
)

// ESClient is the minimal interface we need from Elasticsearch.
type ESClient interface {
	// Index must be idempotent: same docID + version semantics → no duplicate state.
	Index(ctx context.Context, index, docID string, version int64, body []byte) error
	Delete(ctx context.Context, index, docID string, version int64) error
}

type Worker struct {
	DB           *sql.DB
	ES           ESClient
	Index        string
	BatchSize    int
	PollInterval time.Duration
	MaxAttempts  int
	BaseBackoff  time.Duration
	MaxBackoff   time.Duration
	// Cluster-wide advisory lock key — pick any constant int64
	AdvisoryLockKey int64

	// Local guard preventing overlapping ticks within the same process
	running atomic.Bool
}

func (w *Worker) Run(ctx context.Context) error {
	t := time.NewTicker(w.PollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			// (1) Skip this tick if the previous one hasn't finished.
			if !w.running.CompareAndSwap(false, true) {
				slog.Debug("outbox: previous tick still running, skipping")
				continue
			}
			func() {
				defer w.running.Store(false)
				if err := w.tick(ctx); err != nil {
					slog.Error("outbox tick failed", "err", err)
				}
			}()
		}
	}
}
```

### 3.1 The Tick: Cluster-Wide Lock + Claim + Dispatch

```go
func (w *Worker) tick(ctx context.Context) error {
	// (2) Cluster-wide single-leader guarantee using a SESSION advisory lock.
	// pg_try_advisory_lock returns false immediately if another process holds it.
	conn, err := w.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	var gotLock bool
	if err := conn.QueryRowContext(ctx,
		`SELECT pg_try_advisory_lock($1)`, w.AdvisoryLockKey).Scan(&gotLock); err != nil {
		return err
	}
	if !gotLock {
		slog.Debug("outbox: another worker holds the leader lock")
		return nil
	}
	defer conn.ExecContext(context.Background(),
		`SELECT pg_advisory_unlock($1)`, w.AdvisoryLockKey)

	// Drain the queue in batches until empty or context cancelled.
	for {
		n, err := w.processBatch(ctx, conn)
		if err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
}
```

### 3.2 Claim, Send, Mark Done — All Safe Under Concurrency

```go
type outboxRow struct {
	ID             int64
	IdempotencyKey string
	AggregateID    string
	EventType      string
	Payload        []byte
	Version        int64
	Attempts       int
}

func (w *Worker) processBatch(ctx context.Context, conn *sql.Conn) (int, error) {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// (3) Atomically *claim* a batch:
	//   - FOR UPDATE SKIP LOCKED → multiple workers (or future scaling) never
	//     contend on the same row.
	//   - status='processing' marks them as in-flight; if we crash, the next
	//     tick will pick them up again (at-least-once delivery).
	rows, err := tx.QueryContext(ctx, `
		WITH claimed AS (
			SELECT id
			  FROM outbox_events
			 WHERE status IN ('pending','processing')
			   AND next_attempt_at <= now()
			 ORDER BY id
			 FOR UPDATE SKIP LOCKED
			 LIMIT $1
		)
		UPDATE outbox_events o
		   SET status='processing', attempts = o.attempts + 1
		  FROM claimed
		 WHERE o.id = claimed.id
	  RETURNING o.id, o.idempotency_key, o.aggregate_id, o.event_type,
	            o.payload, o.version, o.attempts
	`, w.BatchSize)
	if err != nil {
		return 0, err
	}

	var batch []outboxRow
	for rows.Next() {
		var r outboxRow
		if err := rows.Scan(&r.ID, &r.IdempotencyKey, &r.AggregateID,
			&r.EventType, &r.Payload, &r.Version, &r.Attempts); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, r)
	}
	rows.Close()

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	if len(batch) == 0 {
		return 0, nil
	}

	// Dispatch outside the claiming TX so we don't hold row locks during HTTP I/O.
	for _, r := range batch {
		w.dispatchOne(ctx, r)
	}
	return len(batch), nil
}
```

### 3.3 Strict Idempotency at Elasticsearch

```go
func (w *Worker) dispatchOne(ctx context.Context, r outboxRow) {
	// (4) Idempotency on the consumer side:
	//   - docID = aggregate_id  → same logical entity overwritten in place
	//   - external version = r.Version → ES rejects out-of-order/duplicate
	//     writes with version_conflict_engine_exception, which we treat as success.
	var err error
	switch r.EventType {
	case "upsert":
		err = w.ES.Index(ctx, w.Index, r.AggregateID, r.Version, r.Payload)
	case "delete":
		err = w.ES.Delete(ctx, w.Index, r.AggregateID, r.Version)
	default:
		err = errors.New("unknown event type: " + r.EventType)
	}

	if err == nil || isVersionConflict(err) {
		w.markDone(ctx, r.ID)
		return
	}
	w.markFailed(ctx, r, err)
}

// Elasticsearch returns 409 for version conflicts; treat as already-applied.
type versionConflictErr struct{ error }

func isVersionConflict(err error) bool {
	var v versionConflictErr
	return errors.As(err, &v)
}

func (w *Worker) markDone(ctx context.Context, id int64) {
	_, err := w.DB.ExecContext(ctx,
		`UPDATE outbox_events SET status='done', last_error=NULL WHERE id=$1`, id)
	if err != nil {
		slog.Error("outbox: markDone failed", "id", id, "err", err)
	}
}
```

### 3.4 Exponential Backoff with Full Jitter

```go
func (w *Worker) markFailed(ctx context.Context, r outboxRow, cause error) {
	status := "pending"
	if r.Attempts >= w.MaxAttempts {
		status = "dead" // moved to DLQ; surfaced via metrics/alerts
	}
	delay := backoffWithJitter(r.Attempts, w.BaseBackoff, w.MaxBackoff)
	_, err := w.DB.ExecContext(ctx, `
		UPDATE outbox_events
		   SET status=$2,
		       next_attempt_at = now() + ($3::bigint || ' milliseconds')::interval,
		       last_error=$4
		 WHERE id=$1
	`, r.ID, status, delay.Milliseconds(), cause.Error())
	if err != nil {
		slog.Error("outbox: markFailed update failed", "id", r.ID, "err", err)
	}
}

// "Full jitter" per AWS Architecture Blog: delay = rand(0, min(cap, base*2^attempt))
func backoffWithJitter(attempt int, base, cap time.Duration) time.Duration {
	exp := float64(base) * math.Pow(2, float64(attempt))
	if exp > float64(cap) || exp <= 0 {
		exp = float64(cap)
	}
	return time.Duration(rand.Int63n(int64(exp)))
}
```

## 4. Wiring It Up

```go
func main() {
	db, _ := sql.Open("postgres", os.Getenv("DSN"))
	es := NewESClient(os.Getenv("ES_URL")) // your impl

	w := &outbox.Worker{
		DB:              db,
		ES:              es,
		Index:           "entities",
		BatchSize:       100,
		PollInterval:    500 * time.Millisecond,
		MaxAttempts:     12,
		BaseBackoff:     200 * time.Millisecond,
		MaxBackoff:      5 * time.Minute,
		AdvisoryLockKey: 0xDEADBEEF,
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := w.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}
```

## 5. Why This Is Correct

| Concern | Mechanism |
|---|---|
| **Atomic dual-write** | Business mutation + outbox INSERT share one PG transaction. Either both commit or neither. |
| **Producer-side dedupe** | `idempotency_key UNIQUE` derived from `(aggregate, version, type)` — retried handlers can't enqueue twice. |
| **Consumer-side dedupe** | ES uses `aggregate_id` as `docID` + external `version`. Replays of the same event are no-ops (409 → success). Out-of-order events are rejected, preserving monotonicity. |
| **No overlapping ticks (in-process)** | `atomic.Bool` CAS skips the tick if previous one still running. |
| **No overlapping workers (cluster-wide)** | `pg_try_advisory_lock` — only one process holds it; others no-op until it's released. |
| **Safe parallelism within a tick** | Could you scale to N workers? Yes — drop the advisory lock and rely on `FOR UPDATE SKIP LOCKED` alone; each worker claims a disjoint batch. The advisory lock is a *simplicity* choice. |
| **Crash safety** | A row claimed but not finalized stays `processing` with bumped `attempts`. Next tick re-claims it (at-least-once); ES idempotency ensures correctness. |
| **Backpressure / poison messages** | Full-jitter exponential backoff prevents thundering herds on ES outages. After `MaxAttempts`, rows become `dead` for human inspection (DLQ). |
| **Ordering per aggregate** | Guaranteed by `version` + ES external versioning — even if events are processed in parallel, ES discards stale writes. |

## 6. Operational Notes

- **Cleanup**: a daily job `DELETE FROM outbox_events WHERE status='done' AND created_at < now()-interval '7 days'` keeps the table small.
- **Metrics to export**: `outbox_lag_seconds` (`now() - min(created_at) WHERE status<>'done'`), `outbox_dead_total`, `outbox_attempts_histogram`.
- **Scaling reads**: replace the advisory lock with multiple worker pods relying only on `SKIP LOCKED` — they will naturally shard work.
- **Schema migrations on ES**: include a `schema_version` in payload; reindex jobs bump it and reuse the same outbox machinery.

This gives you Debezium-grade reliability semantics (at-least-once + idempotent apply = effectively-once observable state) with **no external CDC dependency** — just Postgres, Go, and Elasticsearch.