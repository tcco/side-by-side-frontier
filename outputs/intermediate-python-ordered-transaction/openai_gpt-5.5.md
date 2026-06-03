```python
from typing import Any


def batch_transactions(
    transactions: list[dict[str, Any]],
    max_batch_size: int
) -> list[list[dict[str, Any]]]:
    """
    Group transactions into ordered batches whose total size does not exceed
    max_batch_size.

    The original transaction order is preserved exactly. If any single
    transaction's size is greater than max_batch_size, a ValueError is raised.

    Args:
        transactions: A list of transaction dictionaries, each containing:
            - 'id': str
            - 'size': int
        max_batch_size: Maximum allowed total size per batch.

    Returns:
        A list of batches, where each batch is a list of transaction dictionaries.

    Raises:
        ValueError: If a transaction's size exceeds max_batch_size.
    """
    batches: list[list[dict[str, Any]]] = []
    current_batch: list[dict[str, Any]] = []
    current_size = 0

    for transaction in transactions:
        transaction_size = transaction["size"]

        if transaction_size > max_batch_size:
            raise ValueError(
                f"Transaction {transaction.get('id')!r} has size "
                f"{transaction_size}, which exceeds max_batch_size "
                f"{max_batch_size}."
            )

        if current_size + transaction_size > max_batch_size:
            batches.append(current_batch)
            current_batch = []
            current_size = 0

        current_batch.append(transaction)
        current_size += transaction_size

    if current_batch:
        batches.append(current_batch)

    return batches
```

Example usage:

```python
transactions = [
    {"id": "tx1", "size": 4},
    {"id": "tx2", "size": 3},
    {"id": "tx3", "size": 5},
    {"id": "tx4", "size": 2},
]

result = batch_transactions(transactions, max_batch_size=7)

print(result)
```

Output:

```python
[
    [{"id": "tx1", "size": 4}, {"id": "tx2", "size": 3}],
    [{"id": "tx3", "size": 5}, {"id": "tx4", "size": 2}]
]
```

This solution runs in `O(n)` time, where `n` is the number of transactions, and preserves the original ordering exactly.