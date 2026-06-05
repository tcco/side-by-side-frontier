# Lock-Free SPSC Ring Buffer (C++11)

Below is a complete, header-only implementation of a **Single-Producer Single-Consumer (SPSC)** lock-free ring buffer in C++11. The design uses atomic indices with acquire/release semantics and cache-line alignment to prevent false sharing.

---

## Design Overview

### Key Concepts

1. **SPSC Semantics**: Exactly one thread calls `push()` (producer); exactly one thread calls `pop()` (consumer). This restriction lets us avoid CAS loops — plain `load`/`store` on the two indices is sufficient.

2. **Capacity Trick (`N+1` slots)**: To distinguish "empty" (`head == tail`) from "full" without a counter, we allocate `capacity + 1` slots. The buffer is full when advancing `tail` would equal `head`.

3. **Memory Ordering**:
   - The producer **stores** `tail` with `memory_order_release` after writing data — this publishes the write.
   - The consumer **loads** `tail` with `memory_order_acquire` — this synchronizes-with the producer's release, guaranteeing the written element is visible.
   - The consumer mirrors this with `head` (release on advance, acquire when checking fullness).
   - Each side may load *its own* index with `memory_order_relaxed` because no other thread writes it.

4. **False Sharing Prevention**: `head_` and `tail_` are placed on separate cache lines using `alignas(64)`. Without this, the producer writing `tail_` would invalidate the consumer's cache line containing `head_` (and vice versa), causing massive performance loss ("cache line ping-pong").

---

## Implementation

```cpp
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
```

---

## Example / Test Program

```cpp
// main.cpp
#include "spsc_ring_buffer.hpp"
#include <atomic>
#include <iostream>
#include <thread>

int main() {
    SPSCRingBuffer<int> q(1024);

    constexpr int N = 1'000'000;
    std::atomic<bool> done{false};

    std::thread producer([&] {
        for (int i = 0; i < N; ++i) {
            while (!q.push(i)) {
                std::this_thread::yield(); // backoff when full
            }
        }
        done.store(true, std::memory_order_release);
    });

    std::thread consumer([&] {
        long long sum = 0;
        int count = 0;
        int v;
        while (count < N) {
            if (q.pop(v)) {
                sum += v;
                ++count;
            } else if (done.load(std::memory_order_acquire) && q.empty()) {
                break;
            }
        }
        long long expected = (long long)(N - 1) * N / 2;
        std::cout << "received=" << count
                  << " sum=" << sum
                  << " expected=" << expected
                  << (sum == expected ? " OK" : " FAIL") << "\n";
    });

    producer.join();
    consumer.join();
    return 0;
}
```

Compile:

```bash
g++ -std=c++11 -O2 -pthread main.cpp -o spsc_test
./spsc_test
```

---

## Why This Is Correct (Memory-Order Argument)

**Producer → Consumer (data publication):**

1. Producer writes element at `buffer_[tail]` (plain store).
2. Producer does `tail_.store(next, release)`.
3. Consumer does `tail_.load(acquire)` and observes `next`.
4. By the release/acquire synchronizes-with rule, all writes the producer made **before** step 2 (including the element write) **happen-before** subsequent reads in the consumer. So `buffer_[head]` is safe to read.

**Consumer → Producer (slot reclamation):**

1. Consumer destroys/reads element at `buffer_[head]`.
2. Consumer does `head_.store(next, release)`.
3. Producer does `head_.load(acquire)` when checking for full and observes `next`.
4. The producer is now guaranteed to see that the slot is no longer in use before it overwrites it.

**Why relaxed is OK for the "own" index:** In an SPSC queue, only the producer writes `tail_` and only the consumer writes `head_`. A thread always sees its own latest store, so loading its own index relaxed is sufficient.

---

## Design Notes & Trade-offs

| Choice | Reason |
|---|---|
| `capacity + 1` slots | Lets us distinguish full from empty using only two indices — no extra count/atomic needed. |
| `% slots_` modulo | Works for any capacity. If you constrain capacity to a power of two, you can replace `%` with `& (slots_ - 1)` for a measurable speedup. |
| Separate cache lines via `alignas(64)` | Prevents ping-ponging the cache line between cores. This alone can yield 3–10× throughput improvement under contention. |
| Trailing `padding_` | Stops a neighboring object (e.g., the next field in some containing class) from sharing a cache line with `tail_`. |
| `aligned_alloc` + placement-new | Lets us store non-default-constructible / non-trivially-destructible `T` correctly, only constructing/destroying live elements. |
| No locks, no CAS | Pure load/store on atomics; minimal overhead. CAS isn't needed because each index has a single writer. |

---

## Limitations

- **Strictly SPSC.** Multiple producers or multiple consumers will corrupt the buffer. For MPMC, you need a different algorithm (e.g., Vyukov bounded MPMC queue) or a CAS-based design.
- **Non-blocking only.** `push`/`pop` return `false` on full/empty; the caller decides whether to spin, yield, or back off.
- **Fixed capacity** decided at construction.