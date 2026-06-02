To calculate a given Fibonacci number, we can implement a function using an iterative approach. This method is efficient in terms of both time and space complexity. The Fibonacci sequence is defined as follows:

- \( F(0) = 0 \)
- \( F(1) = 1 \)
- \( F(n) = F(n-1) + F(n-2) \) for \( n \geq 2 \)

Here's a Python function that calculates the nth Fibonacci number:

```python
def fibonacci(n):
    """
    Calculate the nth Fibonacci number using an iterative approach.

    :param n: The position in the Fibonacci sequence (non-negative integer).
    :return: The nth Fibonacci number.
    """
    if n < 0:
        raise ValueError("Input must be a non-negative integer.")
    elif n == 0:
        return 0
    elif n == 1:
        return 1

    # Initialize the first two Fibonacci numbers
    prev, curr = 0, 1

    # Iterate to compute the nth Fibonacci number
    for _ in range(2, n + 1):
        prev, curr = curr, prev + curr

    return curr

# Example usage:
n = 10
print(f"The {n}th Fibonacci number is: {fibonacci(n)}")
```

### Explanation:

1. **Input Validation**: The function first checks if the input `n` is a non-negative integer. If `n` is negative, it raises a `ValueError`.

2. **Base Cases**: 
   - If `n` is 0, the function returns 0.
   - If `n` is 1, the function returns 1.

3. **Iterative Calculation**:
   - We initialize two variables, `prev` and `curr`, to represent the two most recent Fibonacci numbers. Initially, `prev` is 0 (F(0)) and `curr` is 1 (F(1)).
   - We then iterate from 2 to `n`, updating `prev` and `curr` to hold the last two Fibonacci numbers. In each iteration, `curr` becomes the sum of `prev` and `curr`, and `prev` takes the old value of `curr`.

4. **Return the Result**: After the loop, `curr` contains the nth Fibonacci number, which is returned.

This approach runs in O(n) time complexity and uses O(1) space complexity, making it efficient for calculating Fibonacci numbers even for relatively large values of `n`.