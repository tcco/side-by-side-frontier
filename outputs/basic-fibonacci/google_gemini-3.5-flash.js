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