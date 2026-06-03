class MovingAverage:
    def __init__(self, window_size: int):
        if window_size <= 0:
            raise ValueError("window_size must be a positive integer")
        self.size = window_size
        self.buffer = [0] * window_size   # circular buffer
        self.index = 0                    # next position to write
        self.count = 0                    # number of values inserted so far
        self.running_sum = 0.0            # sum of values currently in window

    def add(self, val: int) -> float:
        # The value about to be evicted (0 if buffer isn't full yet)
        evicted = self.buffer[self.index]

        # Update running sum in O(1)
        self.running_sum += val - evicted

        # Overwrite the slot with the new value
        self.buffer[self.index] = val

        # Advance index circularly
        self.index = (self.index + 1) % self.size

        # Track how many real elements we've seen (capped at window size)
        if self.count < self.size:
            self.count += 1

        return self.running_sum / self.count