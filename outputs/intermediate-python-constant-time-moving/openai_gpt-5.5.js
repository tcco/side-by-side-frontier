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