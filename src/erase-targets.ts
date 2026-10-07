import type { Editor, TLDrawShape, TLShape } from "tldraw";
import type { Point } from "./arrow-geometry.ts";
import { sampleStroke } from "./scratch-geometry.ts";

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
