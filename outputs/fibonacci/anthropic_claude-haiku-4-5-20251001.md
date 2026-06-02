# Fibonacci Number Calculator

I'll provide multiple solutions with different approaches, from simple to optimized.

## Solution 1: Recursive Approach (Simple but Slow)

```python
def fibonacci_recursive(n):
    """
    Calculate the nth Fibonacci number using recursion.
    
    Args:
        n: Position in Fibonacci sequence (0-indexed)
    
    Returns:
        The nth Fibonacci number
    
    Time Complexity: O(2^n) - exponential
    Space Complexity: O(n) - call stack depth
    """
    if n <= 1:
        return n
    return fibonacci_recursive(n - 1) + fibonacci_recursive(n - 2)


# Test
print(fibonacci_recursive(10))  # Output: 55
```

**Pros:** Simple and intuitive  
**Cons:** Very slow for large numbers due to repeated calculations

---

## Solution 2: Memoization (Optimized Recursive)

```python
def fibonacci_memoization(n, memo=None):
    """
    Calculate the nth Fibonacci number using recursion with memoization.
    
    Args:
        n: Position in Fibonacci sequence (0-indexed)
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


# Test
print(fibonacci_memoization(10))  # Output: 55
```

**Pros:** Much faster than pure recursion  
**Cons:** Uses extra memory for cache

---

## Solution 3: Iterative Approach (Best for Most Cases)

```python
def fibonacci_iterative(n):
    """
    Calculate the nth Fibonacci number using iteration.
    
    Args:
        n: Position in Fibonacci sequence (0-indexed)
    
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


# Test
print(fibonacci_iterative(10))  # Output: 55
```

**Pros:** Fast and memory-efficient  
**Cons:** None significant

---

## Solution 4: Generator (For Sequences)

```python
def fibonacci_generator(limit):
    """
    Generate Fibonacci numbers up to a given limit.
    
    Args:
        limit: Maximum number of Fibonacci numbers to generate
    
    Yields:
        The next Fibonacci number in sequence
    """
    a, b = 0, 1
    count = 0
    
    while count < limit:
        yield a
        a, b = b, a + b
        count += 1


# Test
print(list(fibonacci_generator(10)))  
# Output: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
```

**Pros:** Memory-efficient for large sequences  
**Cons:** Only useful when you need multiple values

---

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
        n: Position in Fibonacci sequence (0-indexed)
    
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


# Test
print(fibonacci_matrix(10))  # Output: 55
```

**Pros:** Fastest for very large numbers  
**Cons:** More complex code

---

## Comparison Table

| Method | Time | Space | Best For |
|--------|------|-------|----------|
| Recursive | O(2^n) | O(n) | Learning only |
| Memoization | O(n) | O(n) | Medium numbers |
| Iterative | O(n) | O(1) | **Most cases** |
| Generator | O(n) | O(1) | Sequences |
| Matrix | O(log n) | O(log n) | Very large numbers |

---

## Complete Example with All Solutions

```python
# Test all methods
n = 15

print(f"Fibonacci({n}):")
print(f"Recursive:     {fibonacci_recursive(n)}")
print(f"Memoization:   {fibonacci_memoization(n)}")
print(f"Iterative:     {fibonacci_iterative(n)}")
print(f"Matrix:        {fibonacci_matrix(n)}")
print(f"Generator:     {list(fibonacci_generator(n))}")

# Output:
# Fibonacci(15):
# Recursive:     610
# Memoization:   610
# Iterative:     610
# Matrix:        610
# Generator:     [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377]
```

---

## Recommendation

**Use the iterative approach** for most practical purposes—it's fast, simple, and memory-efficient!