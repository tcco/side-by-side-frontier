from collections import deque

class MovingAverage:
    def __init__(self, window_size: int):
        """
        Initializes the MovingAverage class with a specific window size.
        """
        self.window_size = window_size
        self.queue = deque()
        self.current_sum = 0
        
    def add(self, val: int) -> float:
        """
        Adds a new value to the stream and returns the current moving average.
        Operates in O(1) time complexity.
        """
        # Add the new value to the queue and the running sum
        self.queue.append(val)
        self.current_sum += val
        
        # If the window exceeds the allowed size, remove the oldest value
        if len(self.queue) > self.window_size:
            oldest_val = self.queue.popleft()
            self.current_sum -= oldest_val
            
        # Calculate and return the average
        return self.current_sum / len(self.queue)

# ==========================================
# Example Usage:
# ==========================================
if __name__ == "__main__":
    # Initialize a moving average with a window size of 3
    moving_average = MovingAverage(3)
    
    print(moving_average.add(1))   # return 1.0  (Window: [1])
    print(moving_average.add(10))  # return 5.5  (Window: [1, 10], Average: 11 / 2)
    print(moving_average.add(3))   # return 4.666666666666667 (Window: [1, 10, 3], Average: 14 / 3)
    print(moving_average.add(5))   # return 6.0  (Window: [10, 3, 5], Average: 18 / 3)