The objective is to write code that calculates a specific Fibonacci number (given an index $n$).

    *   The Fibonacci sequence starts with $0, 1, 1, 2, 3, 5, 8, 13, 21, \dots$
    *   Formula: $F(n) = F(n-1) + F(n-2)$ for $n > 1$.
    *   Base cases: $F(0) = 0, F(1) = 1$.

    *   *Recursive (Naive):* Simple to write, but exponential time complexity $O(2^n)$. Terrible for large $n$.
    *   *Recursive (Memoized):* Top-down approach, linear time $O(n)$, linear space $O(n)$.
    *   *Iterative (Dynamic Programming):* Bottom-up approach, linear time $O(n)$, linear space $O(n)$ (if using an array) or constant space $O(1)$ (if using two variables).
    *   *Matrix Exponentiation:* Logarithmic time $O(\log n)$. Overkill for basic tasks but good for competitive programming.
    *   *Binet's Formula:* Constant time $O(1)$ using floating point math, but loses precision for large $n$.

    *   Python is the best choice for this demonstration because it handles arbitrarily large integers automatically (no overflow issues like in C++ or Java).
    *   I should provide the *Iterative* approach as the primary solution because it's the most efficient for general use (Time: $O(n)$, Space: $O(1)$).

    *   *Input:* $n$ (the index).
    *   *Edge cases:* $n=0$, $n=1$, negative $n$.
    *   *Loop:* From 2 up to $n$.
    *   *Update:* `a, b = b, a + b`.

    *   Explain the logic.
    *   Discuss time and space complexity.
    *   Provide a usage example.