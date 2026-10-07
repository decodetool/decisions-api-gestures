import { arrowEvidencePaths } from '../src/arrow-geometry.ts';

// Exercise the same focused image evidence used by the live canvas.
export function contextForStroke(points, strokes) {
  if (!strokes) return undefined;
  const path = strokes[0], start = path[0], end = path.at(-1);
  const at = (tip) => strokes.slice(1).some((head) => Math.hypot(head[1].x - tip.x, head[1].y - tip.y) < 1);
  return arrowEvidencePaths({ start, end, path, hasStart: at(start), hasEnd: at(end) }, points, 1);
}
