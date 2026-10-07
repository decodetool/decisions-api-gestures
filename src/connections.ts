import type { Editor, TLArrowShape, TLDrawShape, TLShapeId } from "tldraw";
import type { Point } from "./arrow-geometry";

export function bindArrowTips(editor: Editor, arrowId: TLShapeId, tips: { start: Point; end: Point }, strokeId: TLDrawShape["id"]) {
  const arrow = editor.getShape<TLArrowShape>(arrowId);
  if (!arrow) return 0;
  let connections = 0;
  for (const terminal of ["start", "end"] as const) {
    const tip = tips[terminal];
    // Exactly one point hit-test per endpoint. tldraw checks real geometry
    // and returns the topmost eligible shape, including transformed shapes.
    const target = editor.getShapeAtPoint(tip, {
      // Compressed draw points can land a fraction of a pixel outside an
      // edge that the pen touched. Keep this allowance to one screen pixel.
      margin: 1 / editor.getZoomLevel(), hitInside: true, hitLabels: false,
      filter: (shape) => shape.id !== strokeId && shape.id !== arrowId && shape.type !== "draw" &&
        editor.canBindShapes({ fromShape: arrow, toShape: shape, binding: "arrow" }),
    });
    if (!target) continue;
    const localTip = editor.getPointInShapeSpace(target, tip);
    const box = editor.getShapeGeometry(target).bounds;
    connections++;
    editor.createBinding({
      type: "arrow", fromId: arrowId, toId: target.id,
      props: {
        terminal, isPrecise: true, isExact: false, snap: "none",
        normalizedAnchor: {
          x: Math.max(0, Math.min(1, (localTip.x - box.x) / (box.w || 1))),
          y: Math.max(0, Math.min(1, (localTip.y - box.y) / (box.h || 1))),
        },
      },
    });
  }
  return connections;
}
