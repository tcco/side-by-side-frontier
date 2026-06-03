Write a Python function batch_transactions(transactions: list[dict], max_batch_size: int) -> list[list[dict]].
Each dictionary in the list represents a transaction and contains an 'id' (str) and a 'size' (int).
Group the transactions into batches such that the sum of the 'size' in any single batch does not exceed max_batch_size.

You must maintain the exact original order of the transactions.

If a single transaction's size strictly exceeds the max_batch_size, you must raise a ValueError.