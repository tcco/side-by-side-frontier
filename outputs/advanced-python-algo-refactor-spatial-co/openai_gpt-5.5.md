Below is a fully functional sweep-line replacement using only the Python standard library.

Key changes:

- Sort boxes by `x1`.
- Sweep left-to-right.
- Keep only currently “active” boxes whose `x2 >= current.x1`.
- Store active boxes in a custom interval treap keyed by `y1`, augmented with `max_y2`, so we can efficiently query only boxes whose Y-ranges overlap.
- Expire old boxes immediately using a min-heap ordered by `x2`.
- Avoid keeping references to original box dicts inside the sweep structure.

Runtime is `O(N log N + K)`, where `K` is the number of intersections reported. Reporting `K` pairs is unavoidable.

```python
import heapq
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple


Box = Dict[str, Any]
Intersection = Tuple[int, int]

_MASK64 = (1 << 64) - 1


def _priority(uid: int) -> int:
    """
    Deterministic pseudo-random 64-bit priority for the treap.

    Using a mixed priority avoids pathological behavior for already sorted input
    while keeping results deterministic.
    """
    z = (uid + 0x9E3779B97F4A7C15) & _MASK64
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK64
    return z ^ (z >> 31)


class _Node:
    """
    Treap node representing one active rectangle.

    The tree is ordered by `(y1, original_index)`.
    Each subtree stores `max_y2`, allowing fast interval-overlap queries.
    """

    __slots__ = (
        "key",
        "y1",
        "y2",
        "id",
        "index",
        "priority",
        "left",
        "right",
        "max_y2",
    )

    def __init__(self, y1: float, y2: float, box_id: int, index: int) -> None:
        self.key = (y1, index)
        self.y1 = y1
        self.y2 = y2
        self.id = box_id
        self.index = index
        self.priority = _priority(index)
        self.left: Optional["_Node"] = None
        self.right: Optional["_Node"] = None
        self.max_y2 = y2


def _recalc(node: _Node) -> _Node:
    max_y2 = node.y2

    if node.left is not None and node.left.max_y2 > max_y2:
        max_y2 = node.left.max_y2

    if node.right is not None and node.right.max_y2 > max_y2:
        max_y2 = node.right.max_y2

    node.max_y2 = max_y2
    return node


def _rotate_right(root: _Node) -> _Node:
    new_root = root.left
    assert new_root is not None

    root.left = new_root.right
    new_root.right = root

    _recalc(root)
    _recalc(new_root)

    return new_root


def _rotate_left(root: _Node) -> _Node:
    new_root = root.right
    assert new_root is not None

    root.right = new_root.left
    new_root.left = root

    _recalc(root)
    _recalc(new_root)

    return new_root


def _insert(root: Optional[_Node], node: _Node) -> _Node:
    if root is None:
        return node

    if node.key < root.key:
        root.left = _insert(root.left, node)

        if root.left is not None and root.left.priority < root.priority:
            root = _rotate_right(root)
    else:
        root.right = _insert(root.right, node)

        if root.right is not None and root.right.priority < root.priority:
            root = _rotate_left(root)

    return _recalc(root)


def _merge(left: Optional[_Node], right: Optional[_Node]) -> Optional[_Node]:
    if left is None:
        return right

    if right is None:
        return left

    if left.priority < right.priority:
        left.right = _merge(left.right, right)
        return _recalc(left)

    right.left = _merge(left, right.left)
    return _recalc(right)


def _delete(root: Optional[_Node], key: Tuple[float, int]) -> Optional[_Node]:
    if root is None:
        return None

    if key == root.key:
        return _merge(root.left, root.right)

    if key < root.key:
        root.left = _delete(root.left, key)
    else:
        root.right = _delete(root.right, key)

    return _recalc(root)


class _IntervalTreap:
    __slots__ = ("root",)

    def __init__(self) -> None:
        self.root: Optional[_Node] = None

    def insert(self, node: _Node) -> None:
        self.root = _insert(self.root, node)

    def delete(self, key: Tuple[float, int]) -> None:
        self.root = _delete(self.root, key)

    def iter_overlaps(
        self,
        y1: float,
        y2: float,
        current_id: int,
        current_index: int,
    ) -> Iterator[Tuple[int, int, int, int]]:
        """
        Yield intersections with active boxes as:

            original_index_a, original_index_b, id_a, id_b

        where original_index_a < original_index_b.
        """
        yield from self._iter_overlaps(self.root, y1, y2, current_id, current_index)

    def _iter_overlaps(
        self,
        node: Optional[_Node],
        y1: float,
        y2: float,
        current_id: int,
        current_index: int,
    ) -> Iterator[Tuple[int, int, int, int]]:
        if node is None:
            return

        # If every interval in this subtree ends before y1, none can overlap.
        if node.max_y2 < y1:
            return

        # Left subtree can contain intervals with smaller y1.
        if node.left is not None and node.left.max_y2 >= y1:
            yield from self._iter_overlaps(
                node.left,
                y1,
                y2,
                current_id,
                current_index,
            )

        # Current node overlaps iff intervals intersect inclusively.
        if node.y1 <= y2 and node.y2 >= y1:
            if node.index < current_index:
                yield node.index, current_index, node.id, current_id
            else:
                yield current_index, node.index, current_id, node.id

        # Right subtree only needs searching if some interval there could have
        # y1 <= query_y2. Since right subtree y1 values are >= node.y1, if
        # node.y1 > y2, all right-side y1 values are too large.
        if node.y1 <= y2:
            yield from self._iter_overlaps(
                node.right,
                y1,
                y2,
                current_id,
                current_index,
            )


def _normalized_box(
    index: int,
    box: Box,
) -> Tuple[float, float, float, float, int, int]:
    x1 = box["x1"]
    y1 = box["y1"]
    x2 = box["x2"]
    y2 = box["y2"]

    # Be tolerant of reversed coordinates.
    if x1 > x2:
        x1, x2 = x2, x1

    if y1 > y2:
        y1, y2 = y2, y1

    return x1, x2, y1, y2, box["id"], index


def _normalized_boxes(
    boxes: Iterable[Box],
) -> Iterator[Tuple[float, float, float, float, int, int]]:
    for index, box in enumerate(boxes):
        yield _normalized_box(index, box)


def _sweep(
    entries: Iterable[Tuple[float, float, float, float, int, int]],
) -> Iterator[Tuple[int, int, int, int]]:
    active = _IntervalTreap()

    # Heap entries are `(x2, original_index, treap_key)`.
    # Only active boxes are kept here.
    expires: List[Tuple[float, int, Tuple[float, int]]] = []

    for x1, x2, y1, y2, box_id, index in entries:
        # Remove boxes whose right edge is strictly left of current left edge.
        # Strict comparison preserves legacy inclusive intersection semantics.
        while expires and expires[0][0] < x1:
            _, _, key = heapq.heappop(expires)
            active.delete(key)

        # Query active Y-intervals that overlap the current box.
        yield from active.iter_overlaps(y1, y2, box_id, index)

        # Insert current box into active structures.
        node = _Node(y1, y2, box_id, index)
        active.insert(node)
        heapq.heappush(expires, (x2, index, node.key))


def iter_intersections(
    boxes: Iterable[Box],
    *,
    presorted: bool = False,
) -> Iterator[Intersection]:
    """
    Memory-friendly generator version.

    Parameters
    ----------
    boxes:
        Iterable of dicts with keys:
        `id`, `x1`, `y1`, `x2`, `y2`.

    presorted:
        If False, boxes are materialized as compact scalar tuples and sorted by
        x1, giving O(N log N + K) runtime.

        If True, `boxes` must already be sorted by normalized x1. This avoids
        materializing the full input and keeps only the active sweep band in
        memory.

    Yields
    ------
    `(id1, id2)` pairs for intersecting boxes.

    Note
    ----
    Output order is not the same as the legacy O(N^2) double loop. The pair
    orientation follows original input order.
    """
    if presorted:
        entries = _normalized_boxes(boxes)
        for _, _, id1, id2 in _sweep(entries):
            yield id1, id2
        return

    # Materialize only compact scalar tuples, not references to the original
    # dict objects.
    materialized = [_normalized_box(i, box) for i, box in enumerate(boxes)]
    materialized.sort(key=lambda item: item[0])

    # Clear processed entries as the sweep advances so those tuple objects can
    # be reclaimed promptly.
    def clearing_iterator() -> Iterator[Tuple[float, float, float, float, int, int]]:
        for pos in range(len(materialized)):
            entry = materialized[pos]
            materialized[pos] = None  # type: ignore[assignment]
            yield entry  # type: ignore[misc]

    for _, _, id1, id2 in _sweep(clearing_iterator()):
        yield id1, id2


def find_intersections(
    boxes: Iterable[Box],
    *,
    presorted: bool = False,
    preserve_legacy_order: bool = False,
) -> List[Intersection]:
    """
    Drop-in replacement for the legacy function.

    By default, this returns the same intersection pairs but not necessarily in
    the same order as the old double loop.

    If `preserve_legacy_order=True`, the returned list is sorted by original
    input index pair. This costs extra O(K log K), where K is the number of
    intersections.
    """
    if not preserve_legacy_order:
        return list(iter_intersections(boxes, presorted=presorted))

    if presorted:
        indexed = list(_sweep(_normalized_boxes(boxes)))
    else:
        materialized = [_normalized_box(i, box) for i, box in enumerate(boxes)]
        materialized.sort(key=lambda item: item[0])

        def clearing_iterator() -> Iterator[Tuple[float, float, float, float, int, int]]:
            for pos in range(len(materialized)):
                entry = materialized[pos]
                materialized[pos] = None  # type: ignore[assignment]
                yield entry  # type: ignore[misc]

        indexed = list(_sweep(clearing_iterator()))

    indexed.sort(key=lambda item: (item[0], item[1]))
    return [(id1, id2) for _, _, id1, id2 in indexed]
```

Example:

```python
boxes = [
    {"id": 1, "x1": 0, "y1": 0, "x2": 10, "y2": 10},
    {"id": 2, "x1": 5, "y1": 5, "x2": 15, "y2": 15},
    {"id": 3, "x1": 20, "y1": 20, "x2": 30, "y2": 30},
]

print(find_intersections(boxes))
# [(1, 2)]
```

For the lowest memory usage, provide boxes already sorted by `x1` and call:

```python
for pair in iter_intersections(sorted_boxes, presorted=True):
    process(pair)
```