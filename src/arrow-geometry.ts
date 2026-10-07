export type Point = { x: number; y: number };
export type Shaft = { start: Point; end: Point; hasStart: boolean; hasEnd: boolean; path?: Point[] };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function segmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

export function strokeEndpoints(points: Point[]) {
  // Recognition decides the kind of shape, never its attachment points.
  return { start: points[0], end: points.at(-1)! };
}

export function arrowPaths(shaft: Shaft): Point[][] {
  const { start, end } = shaft;
  const path = shaft.path ?? [start, end];
  const length = distance(start, end) || 1;
  const headSize = Math.min(24, Math.max(8, length * 0.12));
  const wing = (tip: Point, neighbor: Point) => {
    const length = distance(tip, neighbor) || 1;
    const ux = (neighbor.x - tip.x) / length, uy = (neighbor.y - tip.y) / length;
    return [
      { x: tip.x + ux * headSize - uy * headSize * 0.65, y: tip.y + uy * headSize + ux * headSize * 0.65 },
      tip,
      { x: tip.x + ux * headSize + uy * headSize * 0.65, y: tip.y + uy * headSize - ux * headSize * 0.65 },
    ];
  };
  return [path, ...(shaft.hasStart ? [wing(start, path[1])] : []), ...(shaft.hasEnd ? [wing(end, path.at(-2)!)] : [])];
}

// tldraw's positive bend goes to the left normal (-dy, dx) of the chord.
// Weight the dominant side by traveled distance so pointer density cannot
// flip the curve. Ignore excursions on the opposite side when taking max.
export function arcBend(points: Point[]) {
  if (points.length < 3) return 0;
  const { start, end } = strokeEndpoints(points);
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
  if (length < 1) return 0;
  const offsets = points.map((p) => (dx * (p.y - start.y) - dy * (p.x - start.x)) / length);
  const area = offsets.slice(1).reduce((sum, offset, i) => sum + (offsets[i] + offset) / 2 * distance(points[i], points[i + 1]), 0);
  if (Math.abs(area) < 1e-6) return 0;
  const side = Math.sign(area);
  return side * Math.max(0, ...offsets.filter((offset) => Math.sign(offset) === side).map(Math.abs));
}

export function boundsOverlap(a: Point[], b: Point[], margin: number) {
  const box = (points: Point[]) => ({
    minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)),
  });
  const x = box(a), y = box(b);
  return x.maxX + margin >= y.minX && x.minX - margin <= y.maxX && x.maxY + margin >= y.minY && x.minY - margin <= y.maxY;
}

export type ArrowEdit = "keep" | "add_head" | "delete_arrow" | "delete_head";
export type ArrowEditEvidence = {
  headAdditionProbability?: number | null;
  headCrossingProbability?: number | null;
  shaftCrossingProbability?: number | null;
};
export function acceptedArrowEdit(shaft: Shaft, result: ArrowEditEvidence): Exclude<ArrowEdit, "keep"> | null {
  if ((result.headAdditionProbability ?? 0) >= 0.65 && (!shaft.hasStart || !shaft.hasEnd)) return "add_head";
  if ((result.headCrossingProbability ?? 0) >= 0.85 && (shaft.hasStart || shaft.hasEnd)) return "delete_head";
  if ((result.shaftCrossingProbability ?? 0) >= 0.85) return "delete_arrow";
  return null;
}

export function nearestBareEnd(points: Point[], shaft: Shaft, tolerance: number): "start" | "end" | null {
  const ends = (["start", "end"] as const).filter((terminal) => terminal === "start" ? !shaft.hasStart : !shaft.hasEnd)
    .map((terminal) => ({ terminal, distance: Math.min(...points.slice(1).map((p, i) => segmentDistance(shaft[terminal], points[i], p))) }))
    .filter((end) => end.distance <= tolerance).sort((a, b) => a.distance - b.distance);
  return ends.length === 1 ? ends[0].terminal : null;
}

// Make small head edits readable on a long connector. This only changes image
// evidence; the actual arrow, contacts and endpoint bindings remain intact.
export function arrowEvidencePaths(shaft: Shaft, points: Point[], zoom: number) {
  const terminal = nearestBareEnd(points, shaft, 18 / zoom) ?? nearestBareEnd(points,
    { ...shaft, hasStart: !shaft.hasStart, hasEnd: !shaft.hasEnd }, 30 / zoom);
  const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
  const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
  if (!terminal || Math.max(width, height) > 120 / zoom) return arrowPaths(shaft);
  const body = shaft.path ?? [shaft.start, shaft.end];
  const ordered = terminal === "start" ? body : [...body].reverse();
  const focused = [ordered[0]];
  let remaining = 100 / zoom;
  for (let i = 1; i < ordered.length && remaining > 0; i++) {
    const length = distance(ordered[i - 1], ordered[i]);
    const ratio = Math.min(1, remaining / (length || 1));
    focused.push({ x: ordered[i - 1].x + (ordered[i].x - ordered[i - 1].x) * ratio,
      y: ordered[i - 1].y + (ordered[i].y - ordered[i - 1].y) * ratio });
    remaining -= length;
  }
  const all = arrowPaths(shaft);
  const head = terminal === "start" ? (shaft.hasStart ? all[1] : undefined)
    : (shaft.hasEnd ? all[shaft.hasStart ? 2 : 1] : undefined);
  return [terminal === "start" ? focused : focused.reverse(), ...(head ? [head] : [])];
}
