import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { b64Vecs, createShapeId, getArrowInfo, type Editor, type TLArrowShape } from "tldraw";
import "tldraw/tldraw.css";
import "../src/style.css";
import { App } from "../src/App";
import { bindArrowTips } from "../src/connections";
import type { Point } from "../src/arrow-geometry";

const BACK = createShapeId("test-back"), START = createShapeId("test-start"), END = createShapeId("test-end"), MIDDLE = createShapeId("test-middle");

function polyline(vertices: Point[]) {
  return vertices.slice(1).flatMap((end, i) => Array.from({ length: 20 }, (_, j) => ({ x: vertices[i].x + (end.x - vertices[i].x) * j / 20, y: vertices[i].y + (end.y - vertices[i].y) * j / 20 }))).concat([vertices.at(-1)!]);
}

function draw(editor: Editor, vertices: Point[], sparse = false) {
  const points = sparse ? vertices : polyline(vertices);
  editor.markHistoryStoppingPoint("Test pen stroke");
  editor.createShape({ id: createShapeId(), type: "draw", props: { color: "blue", isComplete: true, segments: [{ type: "free", dim: 2, path: b64Vecs.encodePoints(points, 2) }] } });
}

function currentArrow(editor: Editor) {
  return editor.getCurrentPageShapes().find((shape): shape is TLArrowShape => shape.type === "arrow");
}

function shaft(editor: Editor) {
  const arrow = currentArrow(editor);
  const info = arrow && getArrowInfo(editor, arrow);
  if (!arrow || !info) return null;
  const transform = editor.getShapePageTransform(arrow);
  const start = transform.applyToPoint(info.start.point), end = transform.applyToPoint(info.end.point);
  const path = info.type === "arc" ? Array.from({ length: 101 }, (_, i) => {
    const arc = info.bodyArc, angle = Math.atan2(info.start.point.y - arc.center.y, info.start.point.x - arc.center.x) + arc.size * i / 100;
    return transform.applyToPoint({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) });
  }) : [start, end];
  return { start, end, path };
}

function scratch(editor: Editor, center: Point, width = 36, height = 28) {
  draw(editor, [{ x: center.x - width / 2, y: center.y - height / 2 }, { x: center.x + width / 2, y: center.y + height / 2 }, { x: center.x - width / 2, y: center.y + height / 3 }, { x: center.x + width / 2, y: center.y - height / 2 }, { x: center.x - width / 2, y: center.y - height / 3 }, { x: center.x + width / 2, y: center.y + height / 3 }, { x: center.x - width / 2, y: center.y + height / 2 }]);
}

function Harness() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [report, setReport] = useState("");
  useEffect(() => {
    if (!editor) return;
    const interval = window.setInterval(() => {
      const arrow = currentArrow(editor);
      const bindings = arrow ? editor.getBindingsFromShape(arrow.id, "arrow").map((binding) => ({ terminal: binding.props.terminal, target: binding.toId })) : [];
      setReport(JSON.stringify({ arrowId: arrow?.id, heads: arrow ? [arrow.props.arrowheadStart, arrow.props.arrowheadEnd] : [], bindings, shaft: (() => { const tips = shaft(editor); return tips ? { start: tips.start, end: tips.end, middle: tips.path[Math.floor(tips.path.length / 2)] } : null; })(), bend: arrow?.props.bend, startExists: Boolean(editor.getShape(START)), backExists: Boolean(editor.getShape(BACK)), middleExists: Boolean(editor.getShape(MIDDLE)), endExists: Boolean(editor.getShape(END)), styles: editor.getCurrentPageShapes().filter((s) => s.type === "geo" || s.type === "arrow" || s.type === "draw").map((s) => ({ type: s.type, color: s.props.color, fill: "fill" in s.props ? s.props.fill : undefined })), pending: editor.getCurrentPageShapes().filter((s) => s.type === "draw").length }, null, 2));
    }, 150);
    return () => window.clearInterval(interval);
  }, [editor]);
  return <>
    <App onEditor={setEditor} />
    <aside style={{ position: "fixed", top: 12, left: 12, zIndex: 9999, width: 250, padding: 12, background: "white", fontSize: 11 }}>
      <p>Live interaction checks — synthetic strokes use the real recognition pipeline.</p>
      <button disabled={!editor} onClick={() => {
        if (!editor) return;
        editor.createShapes([
          { id: BACK, type: "geo", x: 40, y: 240, props: { w: 120, h: 120, geo: "rectangle", fill: "solid", color: "orange" } },
          { id: START, type: "geo", x: 45, y: 245, props: { w: 110, h: 110, geo: "ellipse", fill: "solid", color: "green" } },
          { id: MIDDLE, type: "geo", x: 270, y: 270, props: { w: 80, h: 60, geo: "rectangle", fill: "solid", color: "violet" } },
          { id: END, type: "geo", x: 450, y: 245, props: { w: 100, h: 110, geo: "rectangle", fill: "solid", color: "orange" } },
        ]);
        draw(editor, [{ x: 100, y: 300 }, { x: 500, y: 300 }]);
      }}>Create connected line</button>
      <button disabled={!editor} onClick={() => {
        if (!editor) return;
        editor.createShapes([
          { id: START, type: "geo", x: 45, y: 245, props: { w: 110, h: 110, geo: "rectangle", fill: "solid", color: "green" } },
          { id: END, type: "geo", x: 450, y: 245, props: { w: 100, h: 110, geo: "rectangle", fill: "solid", color: "orange" } },
        ]);
        draw(editor, Array.from({ length: 21 }, (_, i) => ({ x: 155 + 295 * i / 20, y: 300 - 65 * Math.sin(Math.PI * i / 20) })));
      }}>Create curved box connector</button>
      <button onClick={() => editor?.updateShape({ id: START, type: "geo", x: 85, y: 305 })}>Move start shape</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        const previous = tips.path.at(-2)!;
        const dx = tips.end.x - previous.x, dy = tips.end.y - previous.y, length = Math.hypot(dx, dy);
        draw(editor, [{ x: tips.end.x - 25 * dx / length - 20 * dy / length, y: tips.end.y - 25 * dy / length + 20 * dx / length }, tips.end]);
      }}>Add head</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        const next = tips.path[1];
        const dx = next.x - tips.start.x, dy = next.y - tips.start.y, length = Math.hypot(dx, dy);
        draw(editor, [{ x: tips.start.x + 25 * dx / length - 20 * dy / length, y: tips.start.y + 25 * dy / length + 20 * dx / length }, tips.start]);
      }}>Add start head</button>
      <button onClick={() => { if (!editor) return; const tips = shaft(editor); if (tips) scratch(editor, tips.end); }}>Scratch head</button>
      <button onClick={() => { if (!editor) return; const tips = shaft(editor); if (tips) scratch(editor, { x: tips.start.x * 0.15 + tips.end.x * 0.85, y: tips.start.y * 0.15 + tips.end.y * 0.85 }); }}>Scratch line</button>
      <button onClick={() => { if (!editor) return; const target = editor.getShape(START); const box = target && editor.getShapePageBounds(target); if (box) scratch(editor, { x: box.midX, y: box.midY }, 60, 45); }}>Scratch start shape</button>
      <button onClick={() => {
        if (!editor) return;
        const target = editor.getShape(START), box = target && editor.getShapePageBounds(target);
        if (!box) return;
        draw(editor, [0, 1, 2, 3, 4].map((i) => ({ x: box.midX + (i % 2 ? 40 : -40), y: box.midY - 20 + i * 10 })));
      }}>Zigzag out shape</button>
      <button onClick={() => {
        if (!editor) return;
        const target = editor.getShape(START), box = target && editor.getShapePageBounds(target);
        if (!box) return;
        draw(editor, Array.from({ length: 241 }, (_, i) => ({ x: box.midX + 35 * Math.cos(i / 120 * Math.PI * 2), y: box.midY + 25 * Math.sin(i / 120 * Math.PI * 2) })));
      }}>Loop out shape</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        draw(editor, [0, 1, 2, 3, 4].map((i) => ({ x: tips.end.x + (i % 2 ? 15 : -15), y: tips.end.y - 10 + i * 5 })));
      }}>Zigzag out head</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        const previous = tips.path.at(-2)!;
        const dx = tips.end.x - previous.x, dy = tips.end.y - previous.y, length = Math.hypot(dx, dy);
        const center = { x: tips.start.x * 0.2 + tips.end.x * 0.8, y: tips.start.y * 0.2 + tips.end.y * 0.8 };
        draw(editor, [{ x: center.x - dy / length * 15, y: center.y + dx / length * 15 }, { x: center.x + dy / length * 15, y: center.y - dx / length * 15 }], true);
      }}>Cross shaft once</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        const previous = tips.path.at(-2)!;
        const dx = tips.end.x - previous.x, dy = tips.end.y - previous.y, length = Math.hypot(dx, dy);
        draw(editor, [{ x: tips.end.x - dy / length * 45, y: tips.end.y + dx / length * 45 }, { x: tips.end.x + dy / length * 45, y: tips.end.y - dx / length * 45 }]);
      }}>Cross tip once</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        const center = { x: tips.start.x * 0.2 + tips.end.x * 0.8, y: tips.start.y * 0.2 + tips.end.y * 0.8 };
        draw(editor, [{ x: center.x - 4, y: center.y - 4 }, { x: center.x + 4, y: center.y + 4 }, { x: center.x - 3, y: center.y + 2 }]);
      }}>Tiny shaft scribble</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        const previous = tips.path.at(-2)!;
        const dx = tips.end.x - previous.x, dy = tips.end.y - previous.y, length = Math.hypot(dx, dy);
        draw(editor, [{ x: tips.end.x - 24 * dx / length - 14 * dy / length, y: tips.end.y - 24 * dy / length + 14 * dx / length },
          { x: tips.end.x - 19 * dx / length - 20 * dy / length, y: tips.end.y - 19 * dy / length + 20 * dx / length }]);
      }}>Touch head wing</button>
      <button onClick={() => {
        if (!editor) return;
        draw(editor, [{ x: 240, y: 90 }, { x: 390, y: 90 }, { x: 390, y: 190 }, { x: 240, y: 190 }, { x: 240, y: 90 }]);
      }}>Draw rectangle</button>
      <button onClick={() => {
        if (!editor) return;
        draw(editor, Array.from({ length: 61 }, (_, i) => ({ x: 470 + 45 * Math.cos(i / 60 * Math.PI * 2), y: 140 + 45 * Math.sin(i / 60 * Math.PI * 2) })));
      }}>Draw circle</button>
      <button onClick={() => {
        if (!editor) return;
        draw(editor, [{ x: 390, y: 400 }], true);
        const tips = shaft(editor); if (!tips) return;
        const center = { x: tips.start.x * 0.2 + tips.end.x * 0.8, y: tips.start.y * 0.2 + tips.end.y * 0.8 };
        draw(editor, [{ x: center.x, y: center.y - 30 }, { x: center.x, y: center.y + 30 }], true);
      }}>Show feedback colors</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        const center = tips.path.length > 2 ? tips.path[Math.floor(tips.path.length / 2)] : { x: (tips.start.x + tips.end.x) / 2, y: (tips.start.y + tips.end.y) / 2 };
        draw(editor, [{ x: center.x, y: center.y - 22 }, { x: center.x, y: center.y + 22 }], true);
      }}>Slash arc middle</button>
      <button onClick={() => {
        if (!editor) return;
        draw(editor, Array.from({ length: 61 }, (_, i) => ({ x: 155 + 295 * i / 60, y: 100 - 65 * Math.sin(Math.PI * i / 60) })));
      }}>Draw unbound arc</button>
      <button onClick={() => {
        if (!editor) return;
        draw(editor, [{ x: 60, y: 275 }, { x: 540, y: 285 }, { x: 60, y: 300 }, { x: 540, y: 315 }, { x: 60, y: 325 }]);
      }}>Scratch all objects</button>
      <button onClick={() => {
        if (!editor) return;
        editor.createShapes([
          { id: START, type: "geo", x: 45, y: 245, props: { w: 110, h: 110, geo: "rectangle" } },
          { id: END, type: "geo", x: 450, y: 245, props: { w: 100, h: 110, geo: "rectangle" } },
        ]);
        const id = createShapeId();
        editor.createShape({ id, type: "arrow", x: 155, y: 300, props: { start: { x: 0, y: 0 }, end: { x: 295, y: 0 }, bend: -65, arrowheadStart: "arrow", arrowheadEnd: "arrow" } });
        bindArrowTips(editor, id, { start: { x: 155, y: 300 }, end: { x: 450, y: 300 } }, createShapeId());
      }}>Create headed arc fixture</button>
      <button onClick={() => editor?.undo()}>Undo</button>
      <button disabled={!editor} onClick={() => {
        if (!editor) return;
        editor.createShape({ id: START, type: "geo", x: 330, y: 180, props: { w: 120, h: 80, geo: "rectangle" } });
        const id = createShapeId();
        editor.createShape({ id, type: "arrow", x: 390, y: 220, props: { start: { x: 0, y: 0 }, end: { x: 0, y: 300 }, arrowheadStart: "none", arrowheadEnd: "arrow" } });
        // Binding anchor is the box center; the editable visible tail is its bottom edge.
        bindArrowTips(editor, id, { start: { x: 390, y: 220 }, end: { x: 390, y: 520 } }, createShapeId());
      }}>Create vertical tail fixture</button>
      <button onClick={() => {
        if (!editor) return;
        const tips = shaft(editor); if (!tips) return;
        const next = tips.path[1], dx = next.x - tips.start.x, dy = next.y - tips.start.y, length = Math.hypot(dx, dy);
        draw(editor, [
          { x: tips.start.x + 28 * dx / length - 25 * dy / length, y: tips.start.y + 28 * dy / length + 25 * dx / length },
          { x: tips.start.x - 8 * dx / length, y: tips.start.y - 8 * dy / length },
          { x: tips.start.x + 28 * dx / length + 25 * dy / length, y: tips.start.y + 28 * dy / length - 25 * dx / length },
        ]);
      }}>Add tail V overlapping box edge</button>
      <pre data-testid="report" style={{ whiteSpace: "pre-wrap" }}>{report}</pre>
    </aside>
  </>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
