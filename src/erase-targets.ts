import type { Editor, TLDrawShape, TLShape } from "tldraw";
import type { Point } from "./arrow-geometry.ts";
export function sampleStroke(points: Point[], step: number) {
  const output: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < count; j++) output.push({ x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count });
  }
  if (points.length) output.push(points.at(-1)!);
  return output;
}

// Geometry identifies targets only. Decisions supplies the deletion intent.
// getShapesAtPoint returns every layer, including a covered shape underneath.
export function collectScratchShapes(editor: Pick<Editor, "getShapesAtPoint" | "getZoomLevel" | "isShapeHidden">, points: Point[], strokeId: TLDrawShape["id"]) {
  const hits = new Map<string, TLShape>();
  for (const point of sampleStroke(points, 3 / editor.getZoomLevel())) {
    for (const shape of editor.getShapesAtPoint(point, { hitInside: true, margin: 2 / editor.getZoomLevel() })) {
      if (shape.id === strokeId || shape.type === "draw" || shape.isLocked || editor.isShapeHidden(shape)) continue;
      hits.set(shape.id, shape);
    }
  }
  return [...hits.values()];
}
