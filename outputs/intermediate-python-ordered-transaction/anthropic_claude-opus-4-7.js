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