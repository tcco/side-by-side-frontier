Here is a complete, from-scratch implementation of a lock-free, Single-Producer Single-Consumer (SPSC) Ring Buffer in C++11. 

### C++11 Implementation

```cpp
#include <atomic>
#include <memory>
#include <stdexcept>
#include <type_traits>

template <typename T>
class SPSCRingBuffer {
private:
    // Standard cache line size on most modern CPU architectures is 64 bytes.
    // Aligning to this prevents false sharing between the producer and consumer.
    static constexpr size_t CACHE_LINE_SIZE = 64;

    // Read-only data after initialization. 
    // Kept at the top so it doesn't share a cache line with the highly-contended atomics.
    size_t capacity_;
    std::unique_ptr<T[]> buffer_;

    // Producer-modified, Consumer-read
    // alignas forces the variable to start on a new cache line boundary.
    alignas(CACHE_LINE_SIZE) std::atomic<size_t> head_;

    // Consumer-modified, Producer-read
    alignas(CACHE_LINE_SIZE) std::atomic<size_t> tail_;

public:
    /**
     * @brief Constructs the Ring Buffer with a fixed capacity.
     * @param capacity The maximum number of elements the buffer can hold.
     */
    explicit SPSCRingBuffer(size_t capacity) 
        : capacity_(capacity + 1), // Allocate +1 to distinguish full from empty
          buffer_(new T[capacity + 1]), 
          head_(0), 
          tail_(0) 
    {
        if (capacity == 0) {
            throw std::invalid_argument("Capacity must be greater than 0");
        }
    }

    // Delete copy and move semantics to prevent accidental unsafe usage
    SPSCRingBuffer(const SPSCRingBuffer&) = delete;
    SPSCRingBuffer& operator=(const SPSCRingBuffer&) = delete;
    SPSCRingBuffer(SPSCRingBuffer&&) = delete;
    SPSCRingBuffer& operator=(SPSCRingBuffer&&) = delete;

    /**
     * @brief Pushes an item into the buffer (Producer only).
     * @param item The item to insert.
     * @return true if successful, false if the buffer is full.
     */
    bool push(const T& item) {
        // Relaxed load is safe here because only the producer modifies head_
        size_t current_head = head_.load(std::memory_order_relaxed);
        size_t next_head = (current_head + 1) % capacity_;

        // Acquire load of tail_ ensures that we see the consumer's most recent 
        // reads from the buffer before we attempt to overwrite a slot.
        if (next_head == tail_.load(std::memory_order_acquire)) {
            return false; // Buffer is full
        }

        buffer_[current_head] = item;

        // Release store of head_ ensures that the item is fully written to memory 
        // BEFORE the updated head index is made visible to the consumer.
        head_.store(next_head, std::memory_order_release);
        return true;
    }

    /**
     * @brief Pushes an item into the buffer using move semantics (Producer only).
     */
    bool push(T&& item) {
        size_t current_head = head_.load(std::memory_order_relaxed);
        size_t next_head = (current_head + 1) % capacity_;

        if (next_head == tail_.load(std::memory_order_acquire)) {
            return false; 
        }

        buffer_[current_head] = std::move(item);

        head_.store(next_head, std::memory_order_release);
        return true;
    }

    /**
     * @brief Pops an item from the buffer (Consumer only).
     * @param item Reference to store the popped item.
     * @return true if successful, false if the buffer is empty.
     */
    bool pop(T& item) {
        // Relaxed load is safe here because only the consumer modifies tail_
        size_t current_tail = tail_.load(std::memory_order_relaxed);

        // Acquire load of head_ ensures that we see the producer's most recent 
        // writes to the buffer before we attempt to read from a slot.
        if (current_tail == head_.load(std::memory_order_acquire)) {
            return false; // Buffer is empty
        }

        item = std::move(buffer_[current_tail]);

        // Release store of tail_ ensures that our read from the buffer is fully 
        // complete BEFORE the updated tail index is made visible to the producer.
        tail_.store((current_tail + 1) % capacity_, std::memory_order_release);
        return true;
    }
};
```

### Design & Architecture Explanations

#### 1. The Ring Buffer Logic (`N + 1` Capacity)
To differentiate between an **empty** buffer and a **full** buffer without using a separate atomic counter (which would introduce heavy contention between the two threads), the underlying array is allocated with `capacity + 1` slots.
*   **Empty Condition:** `head == tail`
*   **Full Condition:** `(head + 1) % capacity == tail`

#### 2. Explicit Memory Ordering (Acquire / Release)
By default, C++ atomics use `std::memory_order_seq_cst` (Sequential Consistency), which inserts heavy memory barriers. Because this is an SPSC queue, we can safely downgrade to **Acquire-Release semantics** for maximum performance:
*   **Producer (`push`)**: Writes the data to the array, then updates `head_` using `memory_order_release`. This guarantees that the data write *happens-before* the index update.
*   **Consumer (`pop`)**: Reads `head_` using `memory_order_acquire`. This guarantees that any memory writes done by the producer before its release store are now visible to the consumer. It then safely reads the data.
*   **Reverse Synchronization**: The exact same Acquire/Release relationship happens in reverse when the Consumer updates `tail_` and the Producer reads it, ensuring the Producer doesn't overwrite data the Consumer hasn't finished reading.
*   **Relaxed Loads**: When a thread reads its *own* pointer (`head_` for Producer, `tail_` for Consumer), it uses `memory_order_relaxed` because no other thread can modify it.

#### 3. Preventing False Sharing
Modern CPUs load memory into caches in chunks called **Cache Lines** (typically 64 bytes). 
If `head_` and `tail_` were placed next to each other in memory, they would likely share the same cache line. Because the Producer constantly modifies `head_` and the Consumer constantly modifies `tail_`, the CPU cores would continuously invalidate and reload the shared cache line from main memory—a massive performance killer known as **False Sharing** (or Cache Ping-Pong).

Using `alignas(64)` forces the compiler to place `head_` and `tail_` on completely separate cache lines, allowing the Producer and Consumer CPU cores to operate at full speed without hardware-level contention.