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