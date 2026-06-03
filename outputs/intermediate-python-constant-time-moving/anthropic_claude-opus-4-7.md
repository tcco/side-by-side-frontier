# Moving Average from Data Stream

## Problem Analysis

We need to design a class that maintains a sliding window over a stream of integers and returns the average of the most recent `window_size` values whenever a new value is added.

**Key constraint:** The `add` method must run in **O(1) time**.

## Approach

To achieve O(1) per `add` call, we cannot recompute the sum of the window each time (that would be O(k) where k = window_size). Instead, we maintain:

1. **A fixed-size circular buffer (list)** to store the last `window_size` values.
2. **A running sum** of the values currently in the window.
3. **An index pointer** that tells us which slot to overwrite next.
4. **A count** of how many values we've seen so far (until the window fills up).

### Algorithm for `add(val)`:
1. Identify the value currently at the position we're about to overwrite (the oldest value in the window). If the window isn't full yet, that slot is 0.
2. Update the running sum: `sum += val - old_value`.
3. Write `val` into the buffer at the current index.
4. Advance the index circularly: `index = (index + 1) % window_size`.
5. Return `sum / min(count, window_size)`.

All operations above are constant time → **O(1)** per call. Space is **O(window_size)**.

## Code

```python
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
```

## Example Usage

```python
if __name__ == "__main__":
    ma = MovingAverage(3)
    print(ma.add(1))   # 1.0          -> [1]
    print(ma.add(10))  # 5.5          -> [1, 10]
    print(ma.add(3))   # 4.666...     -> [1, 10, 3]
    print(ma.add(5))   # 6.0          -> [10, 3, 5]  (1 evicted)
    print(ma.add(7))   # 5.0          -> [3, 5, 7]   (10 evicted)
```

**Expected output:**
```
1.0
5.5
4.666666666666667
6.0
5.0
```

## Complexity Analysis

| Operation        | Time | Space          |
|------------------|------|----------------|
| `__init__`       | O(k) | O(k)           |
| `add`            | O(1) | O(1) extra     |

Where `k = window_size`.

## Why This Works in O(1)

A naive implementation might use `collections.deque` and recompute `sum(deque) / len(deque)` on each call—but `sum()` is O(k). 

The trick here is **maintaining the sum incrementally**:
- When a new value enters, we add it to the sum.
- When an old value leaves (overwritten in the circular buffer), we subtract it.
- The net update is a single addition and subtraction—constant time regardless of window size.

The circular buffer using a fixed-size list with a moving index avoids any shifting of elements, keeping all bookkeeping in O(1).