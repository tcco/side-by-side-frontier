Target: Algorithmic optimization, state management, and algorithmic constraints.

How to Judge the Output:

The $O(1)$ Test: Many models will append the value to a list and run sum(list[-window_size:]) / size. That is $O(n)$ time relative to the window size. A correct $O(1)$ implementation must maintain a running sum and use a collections.deque (or similar array logic) to subtract the oldest value as it falls out of the window.

Initial State Logic: How does it calculate the average before the window is full? If window_size is 10, but only 3 items have been added, it should divide by 3, not 10.

Zero Handling: Does it handle edge cases where window_size is instantiated as 0 or less?