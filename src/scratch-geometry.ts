import { arrowPaths, segmentDistance, type Point, type Shaft } from "./arrow-geometry.ts";

export function arrowEraseHit(points: Point[], shaft: Shaft, zoom: number, visible: (point: Point) => boolean = () => true) {
  if (points.length < 2) return null;
  const segments = arrowPaths(shaft).flatMap((path) => path.slice(1).map((end, i) => ({ start: path[i], end })));
  const contacts: Point[] = [];
  for (const point of sampleStroke(points, 3 / zoom)) {
    let nearest: Point | null = null, distance = 6 / zoom;
    for (const { start, end } of segments) {
      const d = segmentDistance(point, start, end);
      if (d > distance) continue;
      const dx = end.x - start.x, dy = end.y - start.y;
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
      nearest = { x: start.x + t * dx, y: start.y + t * dy };
      distance = d;
    }
    if (nearest && visible(nearest)) contacts.push(nearest);
  }
  if (!contacts.length) return null;
  // Decide from where the stroke touches the arrow. A long slash through a
  // head still removes only that head; a stroke along the shaft removes all.
  const focus = contacts.reduce((sum, p) => ({ x: sum.x + p.x / contacts.length, y: sum.y + p.y / contacts.length }), { x: 0, y: 0 });
  const length = Math.hypot(shaft.end.x - shaft.start.x, shaft.end.y - shaft.start.y);
  const headRadius = Math.max(14 / zoom, Math.min(30 / zoom, length * 0.2));
  const heads = (["start", "end"] as const).filter((terminal) => terminal === "start" ? shaft.hasStart : shaft.hasEnd)
    .map((terminal) => ({ terminal, distance: Math.hypot(focus.x - shaft[terminal].x, focus.y - shaft[terminal].y) }))
    .sort((a, b) => a.distance - b.distance);
  return { terminal: heads[0]?.distance <= headRadius ? heads[0].terminal : undefined, count: contacts.length };
}

export function sampleStroke(points: Point[], step: number) {
  const output: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < count; j++) output.push({ x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count });
  }
  output.push(points.at(-1)!);
  return output;
}
