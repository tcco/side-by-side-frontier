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