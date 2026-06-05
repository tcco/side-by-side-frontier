import random
from typing import List, Dict, Tuple, Iterator


class _SkipNode:
    __slots__ = ('key', 'box', 'forward')
    def __init__(self, key, box, level):
        self.key = key          # (y1, id) tuple — unique sort key
        self.box = box          # reference to box dict (None for header)
        self.forward = [None] * (level + 1)


class SkipList:
    """
    Ordered map keyed by (y1, id). Supports:
      - insert(box)
      - remove(box)
      - range_query(y_lo, y_hi): iterate boxes with y1 in [y_lo, y_hi]
    Expected O(log N) per op.
    """
    _MAX_LEVEL = 16
    _P = 0.5

    def __init__(self):
        self._header = _SkipNode((-float('inf'), -1), None, self._MAX_LEVEL)
        self._level = 0
        self._rng = random.Random(0xC0FFEE)

    def _random_level(self):
        lvl = 0
        while self._rng.random() < self._P and lvl < self._MAX_LEVEL:
            lvl += 1
        return lvl

    def insert(self, box):
        key = (box['y1'], box['id'])
        update = [None] * (self._MAX_LEVEL + 1)
        cur = self._header
        for i in range(self._level, -1, -1):
            while cur.forward[i] is not None and cur.forward[i].key < key:
                cur = cur.forward[i]
            update[i] = cur

        lvl = self._random_level()
        if lvl > self._level:
            for i in range(self._level + 1, lvl + 1):
                update[i] = self._header
            self._level = lvl

        new_node = _SkipNode(key, box, lvl)
        for i in range(lvl + 1):
            new_node.forward[i] = update[i].forward[i]
            update[i].forward[i] = new_node

    def remove(self, box):
        key = (box['y1'], box['id'])
        update = [None] * (self._MAX_LEVEL + 1)
        cur = self._header
        for i in range(self._level, -1, -1):
            while cur.forward[i] is not None and cur.forward[i].key < key:
                cur = cur.forward[i]
            update[i] = cur

        target = cur.forward[0]
        if target is None or target.key != key:
            return  # not found

        for i in range(self._level + 1):
            if update[i].forward[i] is not target:
                break
            update[i].forward[i] = target.forward[i]

        while self._level > 0 and self._header.forward[self._level] is None:
            self._level -= 1

    def range_query(self, y_lo, y_hi) -> Iterator:
        """Yield boxes whose y1 lies in [y_lo, y_hi]."""
        cur = self._header
        # Descend to lowest node with key >= (y_lo, -inf-ish)
        target_key = (y_lo, -1)
        for i in range(self._level, -1, -1):
            while cur.forward[i] is not None and cur.forward[i].key < target_key:
                cur = cur.forward[i]
        node = cur.forward[0]
        while node is not None and node.key[0] <= y_hi:
            yield node.box
            node = node.forward[0]


def find_intersections(boxes: List[Dict]) -> List[Tuple[int, int]]:
    """
    Sweep-line algorithm in O((N + K) log N) expected time.

    Strategy:
      - Build 2N events sorted by x: START (x1) and END (x2).
      - Active set = SkipList ordered by y1.
      - On START(b): query active set for boxes whose y1 <= b.y2,
        then filter by y1+y_height >= b.y1. Insert b.
      - On END(b):   remove b — releases the only strong ref the
        algorithm holds, so the box can be GC'd if user dropped it.
    """
    if not boxes:
        return []

    # Build events. Use codes 0=START, 1=END so STARTs at same x come
    # first (touching boxes still count as intersecting per original code).
    events = []
    append = events.append
    for b in boxes:
        append((b['x1'], 0, b['id'], b))
        append((b['x2'], 1, b['id'], b))
    events.sort(key=lambda e: (e[0], e[1]))

    active = SkipList()
    intersections = []
    out_append = intersections.append

    for _, kind, _, b in events:
        if kind == 0:  # START — test against currently active boxes
            y1, y2, bid = b['y1'], b['y2'], b['id']
            # Active boxes that overlap b in y satisfy:
            #   other.y1 <= b.y2  AND  other.y2 >= b.y1
            # Range query gives us the first condition cheaply.
            for other in active.range_query(-float('inf'), y2):
                if other['y2'] >= y1:
                    oid = other['id']
                    # Preserve ordering: (smaller_id, larger_id) — optional
                    if oid < bid:
                        out_append((oid, bid))
                    else:
                        out_append((bid, oid))
            active.insert(b)
        else:           # END — drop reference, enabling GC
            active.remove(b)
            # Note: 'b' goes out of scope at loop iteration end.

    return intersections