# Batch Transactions Solution

## Problem Analysis

The task requires grouping transactions into batches while:
1. **Preserving order** — transactions must appear in batches in their original sequence
2. **Respecting size limits** — sum of sizes per batch ≤ `max_batch_size`
3. **Validating inputs** — any single transaction exceeding `max_batch_size` triggers a `ValueError`

Because order must be preserved, this is a **greedy sequential packing** problem (not a bin-packing optimization). We iterate once, adding each transaction to the current batch if it fits, otherwise starting a new batch.

## Solution

```python
def batch_transactions(transactions: list[dict], max_batch_size: int) -> list[list[dict]]:
    """
    Group transactions into ordered batches where each batch's total size
    does not exceed max_batch_size.

    Args:
        transactions: List of dicts, each with keys 'id' (str) and 'size' (int).
        max_batch_size: Maximum allowed sum of 'size' per batch.

    Returns:
        A list of batches (each batch is a list of transaction dicts),
        preserving the original order of transactions.

    Raises:
        ValueError: If max_batch_size is not positive, or if any single
                    transaction's size strictly exceeds max_batch_size.
    """
    if max_batch_size <= 0:
        raise ValueError(f"max_batch_size must be positive, got {max_batch_size}")

    batches: list[list[dict]] = []
    current_batch: list[dict] = []
    current_size = 0

    for tx in transactions:
        size = tx['size']

        # Validate individual transaction size
        if size > max_batch_size:
            raise ValueError(
                f"Transaction '{tx['id']}' has size {size}, "
                f"which exceeds max_batch_size {max_batch_size}"
            )

        # If adding this transaction would overflow, close the current batch
        if current_size + size > max_batch_size:
            batches.append(current_batch)
            current_batch = []
            current_size = 0

        current_batch.append(tx)
        current_size += size

    # Append the final batch if non-empty
    if current_batch:
        batches.append(current_batch)

    return batches
```

## Explanation

### Algorithm Walkthrough
1. **Initialize** an empty list of batches and an empty `current_batch` with running `current_size = 0`.
2. **For each transaction**:
   - Check if its size alone exceeds the limit → raise `ValueError`.
   - If adding it to `current_batch` would exceed `max_batch_size`, flush the current batch into `batches` and start fresh.
   - Add the transaction to `current_batch` and update the running size.
3. **After the loop**, flush any remaining transactions in `current_batch`.

### Complexity
- **Time:** O(n), single pass through transactions.
- **Space:** O(n) for the output structure.

### Edge Cases Handled
| Case | Behavior |
|------|----------|
| Empty `transactions` list | Returns `[]` |
| Single transaction exactly `== max_batch_size` | Goes in its own batch (allowed) |
| Single transaction `> max_batch_size` | Raises `ValueError` |
| Non-positive `max_batch_size` | Raises `ValueError` |
| All transactions fit in one batch | Returns one batch |

## Example Usage

```python
transactions = [
    {'id': 'tx1', 'size': 30},
    {'id': 'tx2', 'size': 50},
    {'id': 'tx3', 'size': 40},
    {'id': 'tx4', 'size': 20},
    {'id': 'tx5', 'size': 100},
]

result = batch_transactions(transactions, max_batch_size=100)
for i, batch in enumerate(result):
    print(f"Batch {i}: {batch}")
```

**Output:**
```
Batch 0: [{'id': 'tx1', 'size': 30}, {'id': 'tx2', 'size': 50}]
Batch 1: [{'id': 'tx3', 'size': 40}, {'id': 'tx4', 'size': 20}]
Batch 2: [{'id': 'tx5', 'size': 100}]
```

### Error Example
```python
batch_transactions([{'id': 'big', 'size': 150}], max_batch_size=100)
# Raises: ValueError: Transaction 'big' has size 150, which exceeds max_batch_size 100
```

## Quick Test Suite

```python
def test_batch_transactions():
    # Basic batching
    txs = [{'id': 'a', 'size': 5}, {'id': 'b', 'size': 5}, {'id': 'c', 'size': 5}]
    assert batch_transactions(txs, 10) == [
        [{'id': 'a', 'size': 5}, {'id': 'b', 'size': 5}],
        [{'id': 'c', 'size': 5}],
    ]

    # Empty input
    assert batch_transactions([], 10) == []

    # Exact fit
    txs = [{'id': 'a', 'size': 10}]
    assert batch_transactions(txs, 10) == [[{'id': 'a', 'size': 10}]]

    # Oversized transaction
    try:
        batch_transactions([{'id': 'x', 'size': 11}], 10)
        assert False, "Expected ValueError"
    except ValueError:
        pass

    # Order preservation
    txs = [{'id': str(i), 'size': 3} for i in range(5)]
    result = batch_transactions(txs, 6)
    flat = [tx for batch in result for tx in batch]
    assert flat == txs

    print("All tests passed ✓")

test_batch_transactions()
```

This greedy approach is optimal given the order constraint — any algorithm that preserves order cannot produce fewer batches than this one.