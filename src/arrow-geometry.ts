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

export type ConnectorEdit = "keep" | "add_tail" | "delete_tail" | "delete_arrow" | "add_head" | "delete_head";
export type ArrowEditEvidence = { connectorEdit?: ConnectorEdit | null; connectorEditProbability?: number | null };
export type AcceptedArrowEdit = { kind: "add_head" | "delete_head" | "delete_arrow"; terminal?: "start" | "end" };

// The model chooses the endpoint. Only check confidence and impossible state
// changes here; never infer a different endpoint from gesture geometry.
export function acceptedArrowEdit(shaft: Shaft, result: ArrowEditEvidence): AcceptedArrowEdit | null {
  const edit = result.connectorEdit;
  if (!edit || edit === "keep") return null;
  const addition = edit === "add_tail" || edit === "add_head";
  if ((result.connectorEditProbability ?? 0) < (addition ? 0.6 : edit === "delete_arrow" ? 0.65 : 0.85)) return null;
  if (edit === "delete_arrow") return { kind: "delete_arrow" };
  const terminal = edit.endsWith("tail") ? "start" : "end";
  const exists = terminal === "start" ? shaft.hasStart : shaft.hasEnd;
  if (addition === exists) return null;
  return { kind: addition ? "add_head" : "delete_head", terminal };
}
