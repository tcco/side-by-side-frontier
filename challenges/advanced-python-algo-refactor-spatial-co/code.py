def find_intersections(boxes):
    # boxes is a list of dicts: {'id': int, 'x1': float, 'y1': float, 'x2': float, 'y2': float}
    intersections = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            b1, b2 = boxes[i], boxes[j]
            if not (b1['x2'] < b2['x1'] or b1['x1'] > b2['x2'] or b1['y2'] < b2['y1'] or b1['y1'] > b2['y2']):
                intersections.append((b1['id'], b2['id']))
    return intersections