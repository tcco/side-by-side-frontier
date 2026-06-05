Below is a single-file, raw C pool allocator. It does **not** include or use `<stdlib.h>`. It uses a statically allocated backing array of size `M`, 8-byte alignment, first-fit search, boundary tags, and immediate left/right coalescing on `my_free`.

```c
/*
 * pool_allocator.c
 *
 * Deterministic first-fit pool allocator with boundary tags.
 * No <stdlib.h> usage.
 */

#include <stddef.h>
#include <stdint.h>

/*
 * Backing pool size. Override at compile time if desired:
 *
 *   cc -DM=8192 ...
 */
#ifndef M
#define M 4096u
#endif

#define ALIGNMENT       ((size_t)8u)
#define TAG_BYTES       ((size_t)8u)                 /* Header/footer size */
#define OVERHEAD        (TAG_BYTES * 2u)             /* Header + footer */
#define MIN_BLOCK_SIZE  (OVERHEAD + ALIGNMENT)       /* Smallest useful block */

#define ALLOC_FLAG      (1ULL)
#define TAG_SIZE_MASK   (~(unsigned long long)(ALIGNMENT - 1u))

/*
 * The pool base must be 8-byte aligned so that:
 *
 *   returned_ptr = block_base + TAG_BYTES
 *
 * is also 8-byte aligned.
 */
#if defined(__STDC_VERSION__) && (__STDC_VERSION__ >= 201112L)
static _Alignas(8) unsigned char g_heap[M];
#define HEAP_BYTES g_heap
#else
/*
 * Fallback for older C compilers. On most embedded ABIs unsigned long long
 * provides at least 8-byte alignment. If your ABI does not, replace this with
 * your compiler-specific alignment attribute.
 */
static union {
    unsigned long long force_alignment;
    unsigned char bytes[M];
} g_heap_storage;
#define HEAP_BYTES g_heap_storage.bytes
#endif

static size_t g_heap_size = 0;
static int g_initialized = 0;

/* ---------- Raw byte helpers ---------- */

static size_t align_down_8(size_t n)
{
    return n & ~(ALIGNMENT - 1u);
}

static size_t align_up_8(size_t n)
{
    return (n + (ALIGNMENT - 1u)) & ~(ALIGNMENT - 1u);
}

static unsigned char *heap_start(void)
{
    return &HEAP_BYTES[0];
}

static unsigned char *heap_end(void)
{
    return heap_start() + g_heap_size;
}

/*
 * Tags are stored manually as 8 bytes. This avoids strict-aliasing and
 * unaligned-access issues from casting unsigned char* to uint64_t*.
 */
static unsigned long long read_tag(const unsigned char *p)
{
    unsigned long long v = 0;
    unsigned int i;

    for (i = 0u; i < 8u; ++i) {
        v |= ((unsigned long long)p[i]) << (8u * i);
    }

    return v;
}

static void write_tag(unsigned char *p, unsigned long long v)
{
    unsigned int i;

    for (i = 0u; i < 8u; ++i) {
        p[i] = (unsigned char)((v >> (8u * i)) & 0xffu);
    }
}

static size_t tag_size(unsigned long long tag)
{
    return (size_t)(tag & TAG_SIZE_MASK);
}

static int tag_is_allocated(unsigned long long tag)
{
    return (tag & ALLOC_FLAG) != 0ULL;
}

static size_t block_size(const unsigned char *block)
{
    return tag_size(read_tag(block));
}

static int block_is_allocated(const unsigned char *block)
{
    return tag_is_allocated(read_tag(block));
}

static void write_block_tags(unsigned char *block, size_t size, int allocated)
{
    unsigned long long tag =
        ((unsigned long long)size & TAG_SIZE_MASK) |
        (allocated ? ALLOC_FLAG : 0ULL);

    /* Header */
    write_tag(block, tag);

    /* Footer */
    write_tag(block + size - TAG_BYTES, tag);
}

/*
 * Validates a block found while walking the heap.
 * Also checks that header and footer boundary tags match.
 */
static int read_valid_block(const unsigned char *block,
                            const unsigned char *end,
                            size_t *size_out)
{
    unsigned long long header;
    unsigned long long footer;
    size_t size;

    if (block >= end) {
        return 0;
    }

    header = read_tag(block);
    size = tag_size(header);

    if (size < OVERHEAD) {
        return 0;
    }

    if ((size & (ALIGNMENT - 1u)) != 0u) {
        return 0;
    }

    if (size > (size_t)(end - block)) {
        return 0;
    }

    footer = read_tag(block + size - TAG_BYTES);
    if (footer != header) {
        return 0;
    }

    *size_out = size;
    return 1;
}

/*
 * Defensive check used by my_free().
 * Ensures the pointer maps exactly to a known block header.
 */
static int is_known_block_header(const unsigned char *candidate)
{
    unsigned char *cur = heap_start();
    unsigned char *end = heap_end();

    while (cur < end) {
        size_t size;

        if (!read_valid_block(cur, end, &size)) {
            return 0;
        }

        if (cur == candidate) {
            return 1;
        }

        cur += size;
    }

    return 0;
}

/* ---------- Initialization ---------- */

static void allocator_init(void)
{
    g_heap_size = align_down_8((size_t)M);
    g_initialized = 1;

    /*
     * If the pool is too small to contain even header+footer,
     * it will simply never allocate.
     */
    if (g_heap_size >= OVERHEAD) {
        write_block_tags(heap_start(), g_heap_size, 0);
    }
}

/* ---------- Coalescing ---------- */

static void coalesce(unsigned char *block)
{
    unsigned char *start = heap_start();
    unsigned char *end = heap_end();
    size_t size = block_size(block);

    /*
     * Coalesce with right neighbor first.
     */
    {
        unsigned char *next = block + size;

        if (next < end) {
            size_t next_size;

            if (read_valid_block(next, end, &next_size) &&
                !block_is_allocated(next)) {
                size += next_size;
                write_block_tags(block, size, 0);
            }
        }
    }

    /*
     * Coalesce with left neighbor using the previous block's footer.
     */
    if (block > start) {
        unsigned long long prev_footer_tag = read_tag(block - TAG_BYTES);
        size_t prev_size = tag_size(prev_footer_tag);

        if (prev_size >= OVERHEAD &&
            (prev_size & (ALIGNMENT - 1u)) == 0u &&
            prev_size <= (size_t)(block - start)) {
            unsigned char *prev = block - prev_size;
            size_t checked_size;

            if (read_valid_block(prev, end, &checked_size) &&
                checked_size == prev_size &&
                !tag_is_allocated(prev_footer_tag)) {
                size += prev_size;
                block = prev;
                write_block_tags(block, size, 0);
            }
        }
    }
}

/* ---------- Public API ---------- */

void *my_malloc(size_t size)
{
    unsigned char *cur;
    unsigned char *end;
    size_t payload_size;
    size_t needed;

    if (!g_initialized) {
        allocator_init();
    }

    if (size == 0u) {
        return NULL;
    }

    if (g_heap_size < OVERHEAD) {
        return NULL;
    }

    /*
     * Overflow-safe enough for embedded/static pool use.
     */
    if (size > ((size_t)-1) - OVERHEAD - (ALIGNMENT - 1u)) {
        return NULL;
    }

    payload_size = align_up_8(size);
    needed = payload_size + OVERHEAD;

    if (needed < MIN_BLOCK_SIZE) {
        needed = MIN_BLOCK_SIZE;
    }

    if (needed > g_heap_size) {
        return NULL;
    }

    cur = heap_start();
    end = heap_end();

    /*
     * First-fit scan.
     */
    while (cur < end) {
        size_t cur_size;

        if (!read_valid_block(cur, end, &cur_size)) {
            /*
             * Heap metadata corruption.
             */
            return NULL;
        }

        if (!block_is_allocated(cur) && cur_size >= needed) {
            size_t remaining = cur_size - needed;

            if (remaining >= MIN_BLOCK_SIZE) {
                /*
                 * Split block.
                 */
                write_block_tags(cur, needed, 1);
                write_block_tags(cur + needed, remaining, 0);
            } else {
                /*
                 * Use entire block to avoid creating a tiny unusable fragment.
                 */
                needed = cur_size;
                write_block_tags(cur, needed, 1);
            }

            /*
             * Payload begins immediately after the header.
             * Since heap base, block size, and TAG_BYTES are all 8-byte aligned,
             * this pointer is 8-byte aligned.
             */
            return (void *)(cur + TAG_BYTES);
        }

        cur += cur_size;
    }

    return NULL;
}

void my_free(void *ptr)
{
    unsigned char *block;
    size_t size;

    if (ptr == NULL) {
        return;
    }

    if (!g_initialized) {
        return;
    }

    if (g_heap_size < OVERHEAD) {
        return;
    }

    /*
     * Defensive range/alignment validation.
     * Passing a pointer not returned by my_malloc is still a programming error,
     * but this prevents many accidental corruptions.
     */
    {
        uintptr_t p = (uintptr_t)ptr;
        uintptr_t start = (uintptr_t)heap_start();
        uintptr_t end = (uintptr_t)heap_end();

        if (p < start + TAG_BYTES || p >= end) {
            return;
        }

        if (((p - start) & (uintptr_t)(ALIGNMENT - 1u)) != 0u) {
            return;
        }

        block = (unsigned char *)(p - TAG_BYTES);
    }

    if (!is_known_block_header(block)) {
        return;
    }

    if (!block_is_allocated(block)) {
        /*
         * Double free or corrupted pointer. Ignore defensively.
         */
        return;
    }

    size = block_size(block);

    /*
     * Mark this block free, then immediately coalesce both directions.
     */
    write_block_tags(block, size, 0);
    coalesce(block);
}
```

### Design notes

- Each block layout is:

```text
+----------+-------------------+----------+
| header   | user payload      | footer   |
| 8 bytes  | 8-byte aligned    | 8 bytes  |
+----------+-------------------+----------+
```

- Header and footer contain the same 64-bit tag.
- The low bit stores `is_allocated`.
- The remaining upper bits store the block size, including header and footer.
- All block sizes are multiples of 8, so the low 3 bits are available for flags.
- Allocation uses **first-fit**.
- `my_free()` immediately coalesces:
  - with the right neighbor using the next block header,
  - with the left neighbor using the previous block footer.

This allocator is deterministic and suitable for simple bare-metal-style environments. For interrupt or multithreaded use, wrap `my_malloc()` and `my_free()` with the appropriate critical section or lock.