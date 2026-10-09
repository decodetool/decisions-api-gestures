// Send the complete visible connector: the server rotates every path together.
export function contextForStroke(_points, strokes) {
  if (!strokes) return {};
  const path = strokes[0], start = path[0], end = path.at(-1);
  const at = (tip) => strokes.slice(1).some((head) => Math.hypot(head[1].x - tip.x, head[1].y - tip.y) < 1);
  return { contextStrokes: strokes, contextConnector: { hasStart: at(start), hasEnd: at(end) } };
}
