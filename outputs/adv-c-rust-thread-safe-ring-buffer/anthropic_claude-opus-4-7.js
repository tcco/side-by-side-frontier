// spsc_ring_buffer.hpp
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdlib>
#include <new>
#include <type_traits>
#include <utility>

// Common cache line size on x86-64 and ARM64.
// C++17 offers std::hardware_destructive_interference_size; we hardcode for C++11.
constexpr std::size_t CACHE_LINE_SIZE = 64;

template <typename T>
class SPSCRingBuffer {
public:
    explicit SPSCRingBuffer(std::size_t capacity)
        : capacity_(capacity),
          slots_(capacity + 1),                // +1 to distinguish full vs empty
          buffer_(static_cast<T*>(
              std::aligned_alloc(alignof(T),
                  // round size up to alignof(T) multiple
                  ((sizeof(T) * (capacity + 1) + alignof(T) - 1) /
                   alignof(T)) * alignof(T)))),
          head_(0),
          tail_(0)
    {
        if (capacity == 0) {
            std::free(buffer_);
            throw std::invalid_argument("capacity must be > 0");
        }
        if (!buffer_) {
            throw std::bad_alloc();
        }
    }

    ~SPSCRingBuffer() {
        // Destroy any remaining elements in [head, tail).
        std::size_t h = head_.load(std::memory_order_relaxed);
        std::size_t t = tail_.load(std::memory_order_relaxed);
        while (h != t) {
            buffer_[h].~T();
            h = (h + 1) % slots_;
        }
        std::free(buffer_);
    }

    // Non-copyable, non-movable
    SPSCRingBuffer(const SPSCRingBuffer&)            = delete;
    SPSCRingBuffer& operator=(const SPSCRingBuffer&) = delete;

    // ---- Producer side ----
    // Push by copy
    bool push(const T& item) {
        return emplace(item);
    }

    // Push by move
    bool push(T&& item) {
        return emplace(std::move(item));
    }

    // Construct in place
    template <typename... Args>
    bool emplace(Args&&... args) {
        const std::size_t tail = tail_.load(std::memory_order_relaxed);
        const std::size_t next = (tail + 1) % slots_;

        // Acquire head from consumer: ensures the slot we're about
        // to write has been logically released (consumed) before we touch it.
        if (next == head_.load(std::memory_order_acquire)) {
            return false; // full
        }

        // Construct element in the slot.
        new (&buffer_[tail]) T(std::forward<Args>(args)...);

        // Release: makes the new element visible to the consumer
        // and "publishes" the new tail.
        tail_.store(next, std::memory_order_release);
        return true;
    }

    // ---- Consumer side ----
    bool pop(T& out) {
        const std::size_t head = head_.load(std::memory_order_relaxed);

        // Acquire tail from producer: synchronizes-with producer's release
        // so the element stored at buffer_[head] is visible to us.
        if (head == tail_.load(std::memory_order_acquire)) {
            return false; // empty
        }

        out = std::move(buffer_[head]);
        buffer_[head].~T();

        const std::size_t next = (head + 1) % slots_;

        // Release: publishes the new head so the producer sees the slot is free.
        head_.store(next, std::memory_order_release);
        return true;
    }

    // Approximate sizes (may be stale due to concurrent updates).
    std::size_t capacity() const noexcept { return capacity_; }

    bool empty() const noexcept {
        return head_.load(std::memory_order_acquire) ==
               tail_.load(std::memory_order_acquire);
    }

private:
    const std::size_t capacity_;
    const std::size_t slots_;   // capacity_ + 1
    T* const          buffer_;

    // Each atomic on its own cache line to avoid false sharing.
    alignas(CACHE_LINE_SIZE) std::atomic<std::size_t> head_; // consumer's index
    alignas(CACHE_LINE_SIZE) std::atomic<std::size_t> tail_; // producer's index

    // Trailing padding so a neighboring object can't share tail_'s line.
    char padding_[CACHE_LINE_SIZE];
};