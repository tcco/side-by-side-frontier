Here is the complete and fully functional solution in Python.

### Approach
To achieve an $O(1)$ time complexity for the `add` method, we cannot recalculate the sum of the window from scratch every time a new value is added. Instead, we can maintain a **running sum** of the elements currently in the window. 

We will use a double-ended queue (`collections.deque`) to store the elements. 
1. When a new value arrives, we add it to the running sum and append it to the right side of the deque.
2. If the size of the deque exceeds the `window_size`, we remove the oldest element from the left side of the deque and subtract its value from the running sum.
3. Finally, we return the running sum divided by the current number of elements in the deque.

Because appending to and popping from the ends of a `deque` both take $O(1)$ time, and updating the sum takes $O(1)$ time, the overall time complexity of the `add` method is strictly $O(1)$.

### Python Code

```python
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
```

### Complexity Analysis
* **Time Complexity:** $\mathcal{O}(1)$ for the `add` method. `deque.append()` and `deque.popleft()` are both $\mathcal{O}(1)$ operations in Python. Updating the sum and dividing are basic arithmetic operations, which also take $\mathcal{O}(1)$ time.
* **Space Complexity:** $\mathcal{O}(N)$ where $N$ is the `window_size`. The `deque` will store at most $N$ elements at any given time.