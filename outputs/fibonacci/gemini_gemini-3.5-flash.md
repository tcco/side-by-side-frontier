Here is a complete, fully functional Python solution to calculate a given Fibonacci number. 

I have provided the **Iterative Approach**, which is the most efficient and practical method for general use because it runs in **$O(n)$ time** and uses **$O(1)$ space** (preventing stack overflow errors that happen with recursion).

### Python Code

```python
def get_fibonacci(n: int) -> int:
    """Calculates the nth Fibonacci number using an iterative approach.

    Time Complexity: O(n)
    Space Complexity: O(1)

    Args:
        n (int): The position in the Fibonacci sequence (0-indexed).

    Returns:
        int: The nth Fibonacci number.
    """
    # Handle negative input
    if n < 0:
        raise ValueError(
            "Fibonacci sequence is not defined for negative integers."
        )

    # Base cases
    if n == 0:
        return 0
    if n == 1:
        return 1

    # Iteratively calculate the sequence
    prev2 = 0  # Represents F(i-2)
    prev1 = 1  # Represents F(i-1)
    current = 0  # Represents F(i)

    for _ in range(2, n + 1):
        current = prev1 + prev2
        # Move pointers forward for the next iteration
        prev2 = prev1
        prev1 = current

    return current


# --- Example Usage and Testing ---
if __name__ == "__main__":
    # Test cases: (n, expected_fibonacci_number)
    test_cases = [
        (0, 0),
        (1, 1),
        (2, 1),
        (3, 2),
        (4, 3),
        (10, 55),
        (50, 12586269025),
        (100, 354224848179261915075),
    ]

    print("Running Fibonacci Tests:")
    print("-" * 40)
    for n, expected in test_cases:
        result = get_fibonacci(n)
        status = "PASS" if result == expected else "FAIL"
        print(f"F({n:3}) = {result:<25} | Expected: {expected:<25} | {status}")
```

---

### How It Works

The Fibonacci sequence is defined as:
*   $F(0) = 0$
*   $F(1) = 1$
*   $F(n) = F(n-1) + F(n-2)$ for $n \ge 2$

#### Why this approach is optimal:
1. **Space Efficiency ($O(1)$):** Instead of keeping track of the entire sequence in an array or using a deep call stack (like recursion), this algorithm only remembers the last two numbers (`prev1` and `prev2`) at any given time.
2. **Time Efficiency ($O(n)$):** It calculates the result in a single loop from $2$ to $n$. 

### Alternative: Recursive with Memoization (Top-Down DP)
If you prefer a recursive approach, using **memoization** (caching previous results) is crucial to prevent the time complexity from exploding to $O(2^n)$. Here is how you can do that cleanly in Python using the built-in `lru_cache`:

```python
from functools import lru_cache


@lru_cache(maxsize=None)
def fibonacci_recursive(n: int) -> int:
    if n < 0:
        raise ValueError("Must be a non-negative integer.")
    if n < 2:
        return n
    return fibonacci_recursive(n - 1) + fibonacci_recursive(n - 2)
```
*Note: While elegant, the recursive version is limited by Python's maximum recursion depth for very large values of $n$ (typically $n > 1000$).*