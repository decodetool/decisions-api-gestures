import type { Editor, TLDrawShape } from "tldraw";

export function dismissStroke(editor: Editor, shape: TLDrawShape, duration: number) {
  const remove = () => editor.run(() => editor.deleteShape(shape.id), { history: "ignore" });
  if (duration === 0) { remove(); return; }
  const started = performance.now();
  let frame = 0;
  const animate = () => {
    if (!editor.getShape(shape.id)) return;
    const opacity = Math.max(0, 1 - (performance.now() - started) / duration);
    editor.run(() => editor.updateShape({ id: shape.id, type: "draw", opacity,
      meta: { ...shape.meta, magicPenFeedback: true } }), { history: "ignore" });
    if (opacity > 0) frame = requestAnimationFrame(animate);
  };
  animate();
  window.setTimeout(() => { cancelAnimationFrame(frame); remove(); }, duration);
}
