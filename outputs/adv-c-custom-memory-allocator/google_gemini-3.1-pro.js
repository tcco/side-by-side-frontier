#include <stddef.h>
#include <stdint.h>

/* --------------------------------------------------------- */
/* Configuration & Memory Pool                               */
/* --------------------------------------------------------- */

#define POOL_SIZE (1024 * 1024) // 1 MB pool size

// Using uint64_t ensures the backing array is 8-byte aligned by the compiler
static uint64_t memory_pool[POOL_SIZE / sizeof(uint64_t)];

static uint8_t *heap_listp = NULL;
static int initialized = 0;

/* --------------------------------------------------------- */
/* Pointer Arithmetic & Boundary Tag Macros                  */
/* --------------------------------------------------------- */

#define WSIZE       8       // Word and header/footer size (bytes)
#define DSIZE       16      // Double word size (bytes)

// Pack a size and allocated bit into a single word
#define PACK(size, alloc)  ((size) | (alloc))

// Read and write a word at address p
#define GET(p)       (*(size_t *)(p))
#define PUT(p, val)  (*(size_t *)(p) = (val))

// Extract the size and allocated fields from address p
#define GET_SIZE(p)  (GET(p) & ~((size_t)7))
#define GET_ALLOC(p) (GET(p) & ((size_t)1))

// Given block payload pointer bp, compute address of its header and footer
#define HDRP(bp)     ((uint8_t *)(bp) - WSIZE)
#define FTRP(bp)     ((uint8_t *)(bp) + GET_SIZE(HDRP(bp)) - DSIZE)

// Given block payload pointer bp, compute address of next and previous blocks
#define NEXT_BLKP(bp)  ((uint8_t *)(bp) + GET_SIZE(((uint8_t *)(bp) - WSIZE)))
#define PREV_BLKP(bp)  ((uint8_t *)(bp) - GET_SIZE(((uint8_t *)(bp) - DSIZE)))

/* --------------------------------------------------------- */
/* Internal Helper Functions                                 */
/* --------------------------------------------------------- */

// Coalesce adjacent free blocks to prevent fragmentation
static void *coalesce(void *bp) {
    // Check allocation status of previous and next blocks
    size_t prev_alloc = GET_ALLOC((uint8_t *)bp - DSIZE); // Footer of previous block
    size_t next_alloc = GET_ALLOC(HDRP(NEXT_BLKP(bp)));   // Header of next block
    size_t size = GET_SIZE(HDRP(bp));                     // Size of current block

    if (prev_alloc && next_alloc) {
        // Case 1: Both adjacent blocks are allocated
        return bp;
    }
    else if (prev_alloc && !next_alloc) {
        // Case 2: Next block is free
        size += GET_SIZE(HDRP(NEXT_BLKP(bp)));
        PUT(HDRP(bp), PACK(size, 0));
        PUT(FTRP(bp), PACK(size, 0)); // FTRP relies on the updated header size
    }
    else if (!prev_alloc && next_alloc) {
        // Case 3: Previous block is free
        size += GET_SIZE(HDRP(PREV_BLKP(bp)));
        PUT(FTRP(bp), PACK(size, 0));
        PUT(HDRP(PREV_BLKP(bp)), PACK(size, 0));
        bp = PREV_BLKP(bp);
    }
    else {
        // Case 4: Both previous and next blocks are free
        size += GET_SIZE(HDRP(PREV_BLKP(bp))) + GET_SIZE(HDRP(NEXT_BLKP(bp)));
        PUT(HDRP(PREV_BLKP(bp)), PACK(size, 0));
        PUT(FTRP(NEXT_BLKP(bp)), PACK(size, 0));
        bp = PREV_BLKP(bp);
    }
    return bp;
}

// Place the requested block and split if the remainder is large enough
static void place(void *bp, size_t asize) {
    size_t csize = GET_SIZE(HDRP(bp));

    // If the remainder is at least 16 bytes (Header + Footer), we split the block
    if ((csize - asize) >= (2 * WSIZE)) {
        PUT(HDRP(bp), PACK(asize, 1));
        PUT(FTRP(bp), PACK(asize, 1));
        
        bp = NEXT_BLKP(bp);
        
        PUT(HDRP(bp), PACK(csize - asize, 0));
        PUT(FTRP(bp), PACK(csize - asize, 0));
    } else {
        // Otherwise, allocate the entire free block
        PUT(HDRP(bp), PACK(csize, 1));
        PUT(FTRP(bp), PACK(csize, 1));
    }
}

// Initialize the memory pool
static void my_allocator_init(void) {
    uint8_t *pool_start = (uint8_t *)memory_pool;

    // Create Prologue block (8 bytes, allocated) to prevent left-coalescing out of bounds
    PUT(pool_start, PACK(WSIZE, 1)); 
    
    // Create the initial massive free block
    size_t free_block_size = POOL_SIZE - (2 * WSIZE);
    PUT(pool_start + WSIZE, PACK(free_block_size, 0));                   // Header
    PUT(pool_start + POOL_SIZE - (2 * WSIZE), PACK(free_block_size, 0)); // Footer
    
    // Create Epilogue block (8 bytes, size 0, allocated) to prevent right-coalescing out of bounds
    PUT(pool_start + POOL_SIZE - WSIZE, PACK(0, 1)); 

    heap_listp = pool_start + (2 * WSIZE); // Point to the first payload
    initialized = 1;
}

/* --------------------------------------------------------- */
/* Public API                                                */
/* --------------------------------------------------------- */

void *my_malloc(size_t size) {
    if (!initialized) {
        my_allocator_init();
    }

    // Ignore spurious requests
    if (size == 0 || size > (size_t)-32) {
        return NULL;
    }

    // Adjust block size to include boundary tags and satisfy 8-byte alignment
    // ALIGN(size) + Header(8) + Footer(8)
    size_t asize = ((size + 7) & ~((size_t)7)) + DSIZE;

    // First-Fit Search
    uint8_t *bp = heap_listp;
    while (GET_SIZE(HDRP(bp)) > 0) { // The Epilogue block has size 0, terminating the loop
        if (!GET_ALLOC(HDRP(bp)) && (GET_SIZE(HDRP(bp)) >= asize)) {
            place(bp, asize);
            return bp;
        }
        bp = NEXT_BLKP(bp);
    }

    // Out of memory (No fit found)
    return NULL;
}

void my_free(void *ptr) {
    if (ptr == NULL) {
        return;
    }

    // Read the size of the block being freed
    size_t size = GET_SIZE(HDRP(ptr));

    // Clear the allocation bit in both the header and the footer
    PUT(HDRP(ptr), PACK(size, 0));
    PUT(FTRP(ptr), PACK(size, 0));

    // Immediately coalesce with adjacent free blocks
    coalesce(ptr);
}