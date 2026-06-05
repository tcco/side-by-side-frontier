# Diagnosis: Read-Modify-Write Race Condition Across `await` Boundaries

## Root Cause Analysis

The bug is a classic **TOCTOU (Time-of-Check-to-Time-of-Use)** race condition, manifesting in two distinct places in your coroutine. Although Python's asyncio is single-threaded, **every `await` is a context switch point** where the event loop is free to schedule another coroutine.

### Defect #1: Non-atomic initialization
```python
if user_id not in shared_state:
    await asyncio.sleep(0.1)   # <-- Context switch!
    shared_state[user_id] = 0
```
If two coroutines for the same `user_id` arrive simultaneously, both pass the `not in` check, both await the simulated DB call, and both reset the balance to `0` — wiping any concurrent update.

### Defect #2: Non-atomic read-modify-write
```python
current_balance = shared_state[user_id]   # READ
await asyncio.sleep(0.05)                 # <-- Context switch!
shared_state[user_id] = current_balance + amount   # WRITE
```
Coroutine A reads `balance=100`, yields. Coroutine B reads `balance=100`, yields. A writes `150`. B writes `120`. **A's update is lost.** This matches the user-reported symptom exactly — "balance updates are occasionally missing or overwritten instead of accumulating."

No exception is raised because nothing is *technically* broken — the dict operations are individually safe; the **logical invariant** (atomicity of the read-modify-write sequence) is violated.

---

## The Fix: Per-User `asyncio.Lock`

The correct solution is **fine-grained locking keyed by `user_id`**, not a single global lock.

```python
import asyncio
from collections import defaultdict

shared_state = {}

# Per-user locks. defaultdict ensures each user_id gets its own Lock lazily.
# The outer lock guards creation of the per-user locks themselves.
_user_locks: dict = {}
_locks_guard = asyncio.Lock()


async def _get_user_lock(user_id) -> asyncio.Lock:
    """Atomically fetch-or-create the lock for a given user."""
    async with _locks_guard:
        lock = _user_locks.get(user_id)
        if lock is None:
            lock = asyncio.Lock()
            _user_locks[user_id] = lock
        return lock


async def process_payment(user_id, amount):
    lock = await _get_user_lock(user_id)

    async with lock:
        # --- Critical section: atomic for this user_id ---
        if user_id not in shared_state:
            await asyncio.sleep(0.1)       # Simulated DB lookup
            shared_state[user_id] = 0

        current_balance = shared_state[user_id]
        await asyncio.sleep(0.05)          # Simulated processing
        shared_state[user_id] = current_balance + amount
        # --- End critical section ---
```

### Key changes
| Change | Why |
|---|---|
| Wrapped the entire read-modify-write block in `async with lock` | Guarantees no other coroutine for the **same** user can interleave at any `await` inside the block |
| Lock is **per `user_id`**, not global | Payments for *different* users still run fully in parallel |
| `_locks_guard` protects the lock-creation dict | Prevents a meta-race where two coroutines create two separate locks for the same user (which would defeat the whole mechanism) |

---

## Why This Doesn't Create a Bottleneck

A naive fix — one global `asyncio.Lock()` wrapping the body — would **serialize every payment in the entire system**, throttling throughput to ~1 / (0.1 + 0.05) = ~6.6 ops/sec regardless of how many users you have. That's unacceptable for a high-throughput system.

With **per-user locks**:

- **Contention scales with concurrent requests *per user*, not total requests.** If you have 10,000 users each receiving 2 concurrent payments, only pairs serialize; the 10,000 users proceed in parallel.
- **The lock-creation guard (`_locks_guard`) is held only for microseconds** — a dict lookup with no `await` inside. It never blocks on I/O, so it's effectively free under load.
- The event loop remains fully cooperative: while user A's coroutine sleeps on its DB I/O inside its lock, user B's coroutine runs freely.

This is the standard pattern for **resource-keyed serialization** in asyncio — same idea as row-level locking in a database vs. table-level locking.

---

## Production Hardening Notes

For a real system, you should also consider:

1. **Memory growth**: `_user_locks` grows unbounded. Use `weakref.WeakValueDictionary` or an LRU eviction policy if user cardinality is high.
2. **Source of truth**: In production, balance state should live in the database with `SELECT ... FOR UPDATE` or optimistic concurrency (a `version` column). The in-process lock is a *defense-in-depth* mechanism, not the primary integrity guarantee — it won't help if you scale to multiple worker processes.
3. **Lock acquisition timeout**: Wrap with `asyncio.wait_for(lock.acquire(), timeout=...)` to prevent unbounded queuing if downstream I/O stalls.