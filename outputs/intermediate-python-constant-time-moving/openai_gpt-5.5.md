```python
from collections import deque


class MovingAverage:
    """
    Calculates the simple moving average over the most recent `window_size` values.

    Each call to add() runs in O(1) time.
    """

    def __init__(self, window_size: int):
        if window_size <= 0:
            raise ValueError("window_size must be a positive integer")

        self.window_size = window_size
        self.window = deque()
        self.current_sum = 0

    def add(self, val: int) -> float:
        """
        Add a new value to the stream and return the current moving average.

        The average is calculated over the last `window_size` values.
        If fewer than `window_size` values have been added, it averages all available values.
        """
        self.window.append(val)
        self.current_sum += val

        if len(self.window) > self.window_size:
            removed = self.window.popleft()
            self.current_sum -= removed

        return self.current_sum / len(self.window)
```

Example usage:

```python
ma = MovingAverage(3)

print(ma.add(1))   # 1.0
print(ma.add(10))  # 5.5
print(ma.add(3))   # 4.666666666666667
print(ma.add(5))   # 6.0, average of [10, 3, 5]
```

The `add` method is `O(1)` because it only performs a constant number of operations: appending a value, optionally removing the oldest value, updating the running sum, and computing the average.