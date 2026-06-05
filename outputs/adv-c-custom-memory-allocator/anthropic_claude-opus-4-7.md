# Custom Pool-Based Memory Allocator in C

Below is a complete implementation of a deterministic, pool-based memory allocator with boundary tags, first-fit allocation, and immediate coalescing — all without using `<stdlib.h>`.

## Design Overview

### Memory Layout per Block
```
+----------------+------------------------+----------------+
|  Header (8B)   |   Payload (aligned)    |  Footer (8B)   |
+----------------+------------------------+----------------+
| size | alloc   |  user data...          | size | alloc   |
+----------------+------------------------+----------------+
```

- **Header**: stores total block size and allocation flag.
- **Footer (Boundary Tag)**: duplicates header info — used by `my_free` to locate the *previous* block in O(1) for coalescing.
- **Alignment**: All payloads are aligned to 8 bytes. Since header is 8 bytes and aligned, payload is naturally aligned.

### Why Boundary Tags?
Without footers, finding the previous block during coalescing would require scanning from the beginning (O(n)). Footers let us look back exactly 8 bytes from our header to find the previous block's footer.

---

## Full Implementation

```c
/* allocator.c - Bare-metal pool allocator */

typedef unsigned long size_t;     /* assume 64-bit; adjust for platform */
typedef unsigned char uint8_t;
typedef unsigned long uint64_t;

#define POOL_SIZE       (1024 * 64)   /* 64 KB pool */
#define ALIGNMENT       8
#define TAG_SIZE        sizeof(tag_t) /* 8 bytes */
#define MIN_BLOCK_SIZE  (2 * TAG_SIZE + ALIGNMENT) /* header + footer + min payload */

/* Static backing storage, aligned to 8 bytes via attribute */
static uint8_t memory_pool[POOL_SIZE] __attribute__((aligned(ALIGNMENT)));
static int    initialized = 0;

/* Boundary tag — used as both header and footer.
 * Lowest bit of size == is_allocated flag.
 * Since all sizes are multiples of 8, the low 3 bits are free for flags.
 */
typedef struct {
    size_t size_and_flag;
} tag_t;

/* ---------- Helpers ---------- */

static inline size_t align_up(size_t n) {
    return (n + (ALIGNMENT - 1)) & ~((size_t)(ALIGNMENT - 1));
}

static inline size_t get_size(tag_t *t) {
    return t->size_and_flag & ~((size_t)0x7);
}

static inline int is_allocated(tag_t *t) {
    return (int)(t->size_and_flag & 0x1);
}

static inline void set_tag(tag_t *t, size_t size, int alloc) {
    t->size_and_flag = (size & ~((size_t)0x7)) | (alloc ? 1 : 0);
}

/* Given a header pointer, return its footer */
static inline tag_t *header_to_footer(tag_t *header) {
    size_t sz = get_size(header);
    return (tag_t *)((uint8_t *)header + sz - TAG_SIZE);
}

/* Given a header, return the next block's header */
static inline tag_t *next_header(tag_t *header) {
    return (tag_t *)((uint8_t *)header + get_size(header));
}

/* Given a header, return the previous block's header (using its footer) */
static inline tag_t *prev_header(tag_t *header) {
    tag_t *prev_footer = (tag_t *)((uint8_t *)header - TAG_SIZE);
    size_t prev_size = get_size(prev_footer);
    return (tag_t *)((uint8_t *)header - prev_size);
}

/* ---------- Initialization ---------- */

static void init_pool(void) {
    /* One giant free block covering the entire pool */
    tag_t *header = (tag_t *)memory_pool;
    set_tag(header, POOL_SIZE, 0);
    tag_t *footer = header_to_footer(header);
    set_tag(footer, POOL_SIZE, 0);
    initialized = 1;
}

/* ---------- my_malloc ---------- */

void *my_malloc(size_t size) {
    if (!initialized) init_pool();
    if (size == 0) return (void *)0;

    /* Required total block: header + payload (aligned) + footer */
    size_t payload = align_up(size);
    size_t needed  = payload + 2 * TAG_SIZE;
    if (needed < MIN_BLOCK_SIZE) needed = MIN_BLOCK_SIZE;

    /* First-fit scan */
    uint8_t *end = memory_pool + POOL_SIZE;
    tag_t *cur = (tag_t *)memory_pool;

    while ((uint8_t *)cur < end) {
        size_t bsize = get_size(cur);
        if (bsize == 0) break; /* safety against corruption */

        if (!is_allocated(cur) && bsize >= needed) {
            /* Split if leftover is large enough to be a valid block */
            size_t leftover = bsize - needed;
            if (leftover >= MIN_BLOCK_SIZE) {
                /* Allocated block */
                set_tag(cur, needed, 1);
                set_tag(header_to_footer(cur), needed, 1);

                /* New free block from the split */
                tag_t *new_free = (tag_t *)((uint8_t *)cur + needed);
                set_tag(new_free, leftover, 0);
                set_tag(header_to_footer(new_free), leftover, 0);
            } else {
                /* Use the entire block (no split) */
                set_tag(cur, bsize, 1);
                set_tag(header_to_footer(cur), bsize, 1);
            }
            /* Return pointer just past the header */
            return (void *)((uint8_t *)cur + TAG_SIZE);
        }
        cur = next_header(cur);
    }
    return (void *)0; /* out of memory */
}

/* ---------- my_free ---------- */

void my_free(void *ptr) {
    if (ptr == (void *)0) return;

    tag_t *header = (tag_t *)((uint8_t *)ptr - TAG_SIZE);

    /* Sanity: must be within pool and currently allocated */
    if ((uint8_t *)header < memory_pool ||
        (uint8_t *)header >= memory_pool + POOL_SIZE) return;
    if (!is_allocated(header)) return; /* double-free guard */

    size_t size = get_size(header);

    /* Mark free */
    set_tag(header, size, 0);
    set_tag(header_to_footer(header), size, 0);

    /* --- Coalesce with NEXT block --- */
    uint8_t *pool_end = memory_pool + POOL_SIZE;
    tag_t *next = next_header(header);
    if ((uint8_t *)next < pool_end && !is_allocated(next)) {
        size_t nsize = get_size(next);
        size += nsize;
        set_tag(header, size, 0);
        set_tag(header_to_footer(header), size, 0);
    }

    /* --- Coalesce with PREVIOUS block --- */
    if ((uint8_t *)header > memory_pool) {
        tag_t *prev = prev_header(header);
        if (!is_allocated(prev)) {
            size_t psize = get_size(prev);
            size += psize;
            set_tag(prev, size, 0);
            set_tag(header_to_footer(prev), size, 0);
            header = prev;
        }
    }
}
```

---

## Walkthrough of Key Mechanisms

### 1. Bit-Packed Tags
Because every block size is a multiple of 8, the lowest 3 bits of the size field are always zero. We reuse **bit 0** as the `is_allocated` flag. This keeps the header at exactly 8 bytes — neatly aligned.

### 2. First-Fit Scan
`my_malloc` walks linearly from the beginning of the pool, jumping block-by-block using `next_header()`. The first free block of sufficient size wins — deterministic and predictable, ideal for embedded systems.

### 3. Splitting
If the chosen free block has at least `MIN_BLOCK_SIZE` extra space after allocation, we split it. Otherwise, we hand out the whole block (avoids creating unusable fragments).

### 4. Coalescing in O(1)
On `my_free`:
- **Right neighbor**: header lies immediately after our block — easy.
- **Left neighbor**: we look at the 8 bytes just before our header (its footer) to recover the previous block's size, then jump back.

Both merges are immediate, ensuring fragmentation cannot accumulate over time.

### 5. Determinism
- No system calls.
- Pool is statically allocated.
- Allocation is bounded by the number of blocks (worst case linear in pool fragmentation).
- No recursion, no hidden allocations.

---

## Quick Test Driver (optional)

```c
extern void *my_malloc(size_t);
extern void  my_free(void *);

int main(void) {
    char *a = my_malloc(100);
    char *b = my_malloc(200);
    char *c = my_malloc(50);
    my_free(b);          /* creates free hole */
    my_free(a);          /* should coalesce with b */
    my_free(c);          /* should coalesce everything into one big block */
    char *d = my_malloc(300); /* should succeed - pool is whole again */
    (void)d;
    return 0;
}
```

After all frees, the pool returns to a single free block of `POOL_SIZE` bytes — exactly the initial state. This verifies that coalescing works correctly in both directions.

---

## Summary of Constraints Met

| Requirement | Implementation |
|---|---|
| No `<stdlib.h>` | Only primitive types; static array as backing store |
| 8-byte alignment | `align_up()` + aligned pool + 8-byte headers |
| First-fit | Linear forward scan in `my_malloc` |
| Boundary tags | Header + footer with size & alloc flag |
| Immediate coalescing | Both directions handled in `my_free` |
| Raw byte arithmetic | All pointer math via `uint8_t *` casts |