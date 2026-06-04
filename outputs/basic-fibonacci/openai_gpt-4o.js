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