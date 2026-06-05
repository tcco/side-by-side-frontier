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