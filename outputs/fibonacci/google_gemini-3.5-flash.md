Here is a complete, highly efficient Python solution to calculate a given Fibonacci number. 

This solution uses an **iterative approach (Dynamic Programming)**. It is the most practical method for general use because it runs in **$O(n)$ time** and uses **$O(1)$ space**, avoiding the stack overflow and performance issues of simple recursion.

### Python Code

```python
def fibonacci(n: int) -> int:
    """Calculates the n-th Fibonacci number.

    Time Complexity: O(n)
    Space Complexity: O(1)
    """
    # Handle negative inputs
    if n < 0:
        raise ValueError("Fibonacci number is not defined for negative integers.")

    # Base cases
    if n == 0:
        return 0
    elif n == 1:
        return 1

    # Iterative calculation
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b

    return b


# --- Example Usage ---
if __name__ == "__main__":
    # Test cases
    test_values = [0, 1, 2, 10, 50, 100]

    print("Fibonacci Sequence Calculations:")
    print("-" * 35)
    for val in test_values:
        print(f"F({val}) = {fibonacci(val)}")
```

### How It Works

1. **Edge Cases**: The function first checks if the input $n$ is negative and raises an error if so. It then directly returns `0` for $n = 0$ and `1` for $n = 1$.
2. **The Loop**: Instead of using recursion (which recalculates the same values over and over), we use a loop. 
3. **Variable Swapping**: We keep track of only the last two Fibonacci numbers in variables `a` and `b`. In each iteration of the loop:
   * `a` becomes the old `b`.
   * `b` becomes the sum of the old `a` and `b` (`a + b`).
4. **Return**: After looping $n-1$ times, `b` holds the $n$-th Fibonacci number.

### Complexity Analysis

* **Time Complexity:** $\mathcal{O}(n)$ — We loop exactly $n$ times, making it incredibly fast even for larger numbers (like $n = 10000$).
* **Space Complexity:** $\mathcal{O}(1)$ — We only store two integer variables (`a` and `b`) in memory, regardless of how large $n$ is.

---

### Alternative: Recursive Approach with Memoization (Caching)
If you prefer a recursive style but still want it to be fast, you can use Python's built-in `lru_cache` decorator. This stores the results of previous function calls so they don't have to be recomputed.

```python
from functools import lru_cache


@lru_cache(maxsize=None)
def fibonacci_recursive(n: int) -> int:
    if n < 0:
        raise ValueError("Input must be non-negative")
    if n < 2:
        return n
    return fibonacci_recursive(n - 1) + fibonacci_recursive(n - 2)
```
*Note: While elegant, this recursive method is limited by Python's maximum recursion depth for very large values of $n$ (typically around $n = 1000$). The iterative method above is preferred for production.*