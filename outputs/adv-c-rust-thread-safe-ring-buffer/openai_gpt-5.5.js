#include <atomic>
#include <cstddef>
#include <limits>
#include <memory>
#include <new>
#include <stdexcept>
#include <type_traits>
#include <utility>

template <typename T>
class SpscRingBuffer {
private:
    static const std::size_t CACHE_LINE_SIZE = 64;

    using Storage = typename std::aligned_storage<sizeof(T), alignof(T)>::type;

    struct alignas(CACHE_LINE_SIZE) PaddedAtomicSize {
        std::atomic<std::size_t> value;

        explicit PaddedAtomicSize(std::size_t initial = 0)
            : value(initial) {}
    };

    static_assert(sizeof(PaddedAtomicSize) >= CACHE_LINE_SIZE,
                  "PaddedAtomicSize must occupy at least one cache line");

    static_assert(alignof(PaddedAtomicSize) >= CACHE_LINE_SIZE,
                  "PaddedAtomicSize must be cache-line aligned");

public:
    explicit SpscRingBuffer(std::size_t capacity)
        : capacity_(checked_capacity(capacity)),
          buffer_(new Storage[capacity_]),
          read_index_(0),
          write_index_(0) {
        // The algorithm is lock-free only if size_t atomics are lock-free
        // on the target platform.
        if (!read_index_.value.is_lock_free() ||
            !write_index_.value.is_lock_free()) {
            throw std::runtime_error("std::atomic<std::size_t> is not lock-free");
        }
    }

    ~SpscRingBuffer() {
        // Destructor must not run concurrently with producer/consumer.
        std::size_t read = read_index_.value.load(std::memory_order_relaxed);
        std::size_t write = write_index_.value.load(std::memory_order_relaxed);

        while (read != write) {
            slot_ptr(read)->~T();
            ++read;
        }
    }

    SpscRingBuffer(const SpscRingBuffer&) = delete;
    SpscRingBuffer& operator=(const SpscRingBuffer&) = delete;

    SpscRingBuffer(SpscRingBuffer&&) = delete;
    SpscRingBuffer& operator=(SpscRingBuffer&&) = delete;

    std::size_t capacity() const noexcept {
        return capacity_;
    }

    bool push(const T& item) {
        return emplace(item);
    }

    bool push(T&& item) {
        return emplace(std::move(item));
    }

    template <typename... Args>
    bool emplace(Args&&... args) {
        // Only the producer writes write_index_, so this load can be relaxed.
        const std::size_t write =
            write_index_.value.load(std::memory_order_relaxed);

        // Acquire pairs with the consumer's release-store to read_index_.
        // This ensures the producer observes slot destruction before reuse.
        const std::size_t read =
            read_index_.value.load(std::memory_order_acquire);

        if (write - read >= capacity_) {
            return false; // full
        }

        new (slot_address(write)) T(std::forward<Args>(args)...);

        // Release publishes the constructed element to the consumer.
        write_index_.value.store(write + 1, std::memory_order_release);

        return true;
    }

    bool pop(T& out) {
        // Only the consumer writes read_index_, so this load can be relaxed.
        const std::size_t read =
            read_index_.value.load(std::memory_order_relaxed);

        // Acquire pairs with the producer's release-store to write_index_.
        // This ensures the consumer sees the fully constructed element.
        const std::size_t write =
            write_index_.value.load(std::memory_order_acquire);

        if (read == write) {
            return false; // empty
        }

        T* item = slot_ptr(read);

        out = std::move(*item);
        item->~T();

        // Release publishes that this slot is now free for the producer.
        read_index_.value.store(read + 1, std::memory_order_release);

        return true;
    }

private:
    static std::size_t checked_capacity(std::size_t capacity) {
        if (capacity == 0) {
            throw std::invalid_argument("SpscRingBuffer capacity must be non-zero");
        }

        // Keeps unsigned sequence-number subtraction unambiguous.
        if (capacity > std::numeric_limits<std::size_t>::max() / 2) {
            throw std::invalid_argument("SpscRingBuffer capacity is too large");
        }

        return capacity;
    }

    void* slot_address(std::size_t sequence) noexcept {
        return static_cast<void*>(&buffer_[sequence % capacity_]);
    }

    T* slot_ptr(std::size_t sequence) noexcept {
        return reinterpret_cast<T*>(&buffer_[sequence % capacity_]);
    }

private:
    const std::size_t capacity_;
    std::unique_ptr<Storage[]> buffer_;

    // Consumer-owned read index.
    PaddedAtomicSize read_index_;

    // Producer-owned write index.
    PaddedAtomicSize write_index_;
};