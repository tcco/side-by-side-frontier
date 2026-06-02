# Fibonacci Number Calculator

I'll provide multiple solutions with different approaches, from simple to optimized.

## Solution 1: Recursive Approach (Simple but Slow)

```python
def fibonacci_recursive(n):
    """
    Calculate the nth Fibonacci number using recursion.
    
    Args:
        n: The position in the Fibonacci sequence (0-indexed)
    
    Returns:
        The nth Fibonacci number
    
    Time Complexity: O(2^n) - Very slow for large n
    Space Complexity: O(n) - Call stack depth
    """
    if n <= 1:
        return n
    return fibonacci_recursive(n - 1) + fibonacci_recursive(n - 2)

# Example usage
print(fibonacci_recursive(10))  # Output: 55
```

## Solution 2: Memoization (Optimized Recursion)

```python
def fibonacci_memoization(n, memo=None):
    """
    Calculate the nth Fibonacci number using recursion with memoization.
    
    Args:
        n: The position in the Fibonacci sequence (0-indexed)
        memo: Dictionary to store previously calculated values
    
    Returns:
        The nth Fibonacci number
    
    Time Complexity: O(n)
    Space Complexity: O(n)
    """
    if memo is None:
        memo = {}
    
    if n in memo:
        return memo[n]
    
    if n <= 1:
        return n
    
    memo[n] = fibonacci_memoization(n - 1, memo) + fibonacci_memoization(n - 2, memo)
    return memo[n]

# Example usage
print(fibonacci_memoization(10))  # Output: 55
```

## Solution 3: Iterative Approach (Best for Most Cases)

```python
def fibonacci_iterative(n):
    """
    Calculate the nth Fibonacci number using iteration.
    
    Args:
        n: The position in the Fibonacci sequence (0-indexed)
    
    Returns:
        The nth Fibonacci number
    
    Time Complexity: O(n)
    Space Complexity: O(1)
    """
    if n <= 1:
        return n
    
    prev, curr = 0, 1
    for _ in range(2, n + 1):
        prev, curr = curr, prev + curr
    
    return curr

# Example usage
print(fibonacci_iterative(10))  # Output: 55
```

## Solution 4: Generator (For Sequences)

```python
def fibonacci_generator(limit):
    """
    Generate Fibonacci numbers up to a given limit.
    
    Args:
        limit: Maximum number of Fibonacci numbers to generate
    
    Yields:
        The next Fibonacci number in the sequence
    
    Time Complexity: O(n)
    Space Complexity: O(1)
    """
    a, b = 0, 1
    count = 0
    
    while count < limit:
        yield a
        a, b = b, a + b
        count += 1

# Example usage
print(list(fibonacci_generator(10)))  # Output: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
```

## Solution 5: Matrix Exponentiation (Fastest for Very Large Numbers)

```python
def matrix_multiply(a, b):
    """Multiply two 2x2 matrices."""
    return [
        [a[0][0]*b[0][0] + a[0][1]*b[1][0], a[0][0]*b[0][1] + a[0][1]*b[1][1]],
        [a[1][0]*b[0][0] + a[1][1]*b[1][0], a[1][0]*b[0][1] + a[1][1]*b[1][1]]
    ]

def matrix_power(matrix, n):
    """Calculate matrix^n using fast exponentiation."""
    if n == 1:
        return matrix
    
    if n % 2 == 0:
        half = matrix_power(matrix, n // 2)
        return matrix_multiply(half, half)
    else:
        return matrix_multiply(matrix, matrix_power(matrix, n - 1))

def fibonacci_matrix(n):
    """
    Calculate the nth Fibonacci number using matrix exponentiation.
    
    Args:
        n: The position in the Fibonacci sequence (0-indexed)
    
    Returns:
        The nth Fibonacci number
    
    Time Complexity: O(log n)
    Space Complexity: O(log n)
    """
    if n <= 1:
        return n
    
    base_matrix = [[1, 1], [1, 0]]
    result = matrix_power(base_matrix, n)
    return result[0][1]

# Example usage
print(fibonacci_matrix(10))  # Output: 55
```

## Complete Test Program

```python
def test_all_solutions():
    """Test all Fibonacci implementations."""
    test_cases = [0, 1, 5, 10, 20, 30]
    
    print("Testing all Fibonacci solutions:\n")
    
    for n in test_cases:
        print(f"Fibonacci({n}):")
        print(f"  Recursive:      {fibonacci_recursive(n)}")
        print(f"  Memoization:    {fibonacci_memoization(n)}")
        print(f"  Iterative:      {fibonacci_iterative(n)}")
        print(f"  Matrix:         {fibonacci_matrix(n)}")
        print()

if __name__ == "__main__":
    test_all_solutions()
```

## Performance Comparison

| Approach | Time | Space | Best For |
|----------|------|-------|----------|
| Recursive | O(2^n) | O(n) | Educational purposes only |
| Memoization | O(n) | O(n) | Medium values of n |
| Iterative | O(n) | O(1) | **Most practical use cases** |
| Generator | O(n) | O(1) | Generating sequences |
| Matrix | O(log n) | O(log n) | Very large n values |

## Recommendation

**Use `fibonacci_iterative()`** for most practical applications—it's simple, efficient, and easy to understand.