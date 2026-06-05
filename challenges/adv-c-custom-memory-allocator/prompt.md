Write a custom, deterministic pool-based memory allocator in raw C (mimicking a bare-metal embedded system environment) without using <stdlib.h>. The allocator must manage a statically allocated backing array of size $M$. It should expose void* my_malloc(size_t size) and void my_free(void* ptr).The allocator must:

Align all allocated memory blocks to 8-byte boundaries.
Implement a 'First-Fit' allocation strategy.
Implement boundary tags for each block storing block size and an 'is_allocated' flag.
Crucial constraint: my_free must immediately coalesce adjacent free blocks (both left and right) to prevent memory fragmentation.
Handle all pointer arithmetic explicitly using raw byte manipulations.