def batch_transactions(transactions: list[dict], max_batch_size: int) -> list[list[dict]]:
    """
    Groups a list of transactions into batches without exceeding the max_batch_size.
    Maintains the original order of the transactions.
    
    Args:
        transactions: A list of dictionaries, each containing 'id' (str) and 'size' (int).
        max_batch_size: The maximum allowable sum of 'size' in a single batch.
        
    Returns:
        A list of batches, where each batch is a list of transaction dictionaries.
        
    Raises:
        ValueError: If any single transaction's size strictly exceeds max_batch_size.
    """
    batches = []
    current_batch = []
    current_batch_size = 0

    for transaction in transactions:
        size = transaction['size']
        
        # Check if a single transaction exceeds the maximum batch size
        if size > max_batch_size:
            raise ValueError(
                f"Transaction '{transaction['id']}' has a size ({size}) "
                f"that strictly exceeds the max_batch_size ({max_batch_size})."
            )
        
        # If adding the current transaction exceeds the limit, close the current batch
        if current_batch_size + size > max_batch_size:
            batches.append(current_batch)
            current_batch = [transaction]
            current_batch_size = size
        else:
            # Otherwise, add it to the current batch
            current_batch.append(transaction)
            current_batch_size += size

    # Don't forget to append the final batch if it contains any transactions
    if current_batch:
        batches.append(current_batch)

    return batches