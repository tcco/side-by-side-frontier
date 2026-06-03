Here is the complete and fully functional solution to your coding task.

### Python Code

```python
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
```

### Explanation of the Logic

1. **Initialization**: We set up `batches` to hold our final list of grouped transactions. We also maintain a `current_batch` list and a `current_batch_size` integer to keep track of the batch we are currently building.
2. **Iteration**: We loop through the `transactions` list sequentially. This guarantees that we **maintain the exact original order**.
3. **Validation**: For every transaction, we immediately check if its `size` is strictly greater than `max_batch_size`. If it is, it's impossible to batch, so we raise a `ValueError` as requested.
4. **Batching**: 
   * We check if adding the current transaction's size to `current_batch_size` pushes it over the `max_batch_size`.
   * If it **does**, we append the `current_batch` to our `batches` list, and start a brand new `current_batch` containing only the current transaction.
   * If it **doesn't**, we simply append the transaction to the `current_batch` and update the running size total.
5. **Final Cleanup**: After the loop finishes, there will usually be leftover transactions in `current_batch`. We append this last batch to `batches` before returning the result.

### Complexity
* **Time Complexity**: $\mathcal{O}(N)$, where $N$ is the number of transactions. We only iterate through the list of transactions exactly once.
* **Space Complexity**: $\mathcal{O}(N)$ to store the newly grouped batches in memory.

### Example Usage

```python
# Example transactions
txs = [
    {'id': 'tx1', 'size': 10},
    {'id': 'tx2', 'size': 20},
    {'id': 'tx3', 'size': 15},
    {'id': 'tx4', 'size': 5},
    {'id': 'tx5', 'size': 30}
]

# Max batch size of 30
result = batch_transactions(txs, 30)

for i, batch in enumerate(result, 1):
    print(f"Batch {i}: {batch}")
```

**Output:**
```text
Batch 1: [{'id': 'tx1', 'size': 10}, {'id': 'tx2', 'size': 20}]
Batch 2: [{'id': 'tx3', 'size': 15}, {'id': 'tx4', 'size': 5}]
Batch 3: [{'id': 'tx5', 'size': 30}]
```