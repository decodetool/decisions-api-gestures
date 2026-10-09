import { useEffect, useRef, useState } from "react";
import {
  b64Vecs,
  createShapeId,
  getArrowInfo,
  DefaultColorStyle,
  DrawShapeTool,
  type Editor,
  type TLDrawShape,
  type TLArrowShape,
  type TLShape,
  type TLUiOverrides,
  Tldraw,
} from "tldraw";

import { CANVAS_THEMES } from "./theme";
import { strokeEndpoints, arrowPaths, arcBend, boundsOverlap, acceptedArrowEdit, type ArrowEditEvidence, type Point, type Shaft } from "./arrow-geometry";

import { collectScratchShapes } from "./erase-targets";
import { bindArrowTips } from "./connections";
import { dismissStroke } from "./stroke-feedback";

const MAGIC_TOOL_ID = "magic-pen";
const BLUE = "blue" as const;
const MIN_CONFIDENCE = 0.6;
const SHAPE_BLUE = "light-blue" as const;
const STROKE_FADE_MS = 75;
type CallTiming = { apiMs: number | null; costUsd: number | null; receivedAt: number };
type LatencyRow = { apiMs: number | null; costUsd: number | null; uxMs: number };

type RecognitionLabel = "line" | "arc" | "rectangle" | "circle" | "none";

type Recognition = ArrowEditEvidence & {
  label: RecognitionLabel;
  confidence: number | null;

  scratchOutProbability?: number | null;
};

class MagicPenTool extends DrawShapeTool {
  static override id = MAGIC_TOOL_ID;

  override onEnter() {
    this.editor.setStyleForNextShapes(DefaultColorStyle, BLUE);
  }

  override onExit() {
    super.onExit();
    this.editor.setStyleForNextShapes(DefaultColorStyle, "black");
  }
}

// Keep TLDraw's own toolbar, but make its existing pencil slot select the
// Magic Pen. Its native tooltip now reads “Magic Pen” and both B and M select
// it, so there is no competing normal Draw tool in the recording UI.
const uiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    const draw = tools.draw;
    return {
      ...tools,
      draw: {
        ...draw,
        id: MAGIC_TOOL_ID,
        kbd: "b,m",
        onSelect(source) {
          // Preserve TLDraw's built-in toolbar announcement and tracking, then
          // immediately switch from its Draw tool to our replacement.
          draw.onSelect(source);
          selectMagicPen(editor);
        },
      },
    };
  },
  translations: {
    en: { "tool.draw": "Magic Pen" },
  },
};

function bounds(points: Point[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: Math.max(12, maxX - minX), h: Math.max(12, maxY - minY) };
}

function getStrokePoints(editor: Editor, shape: TLDrawShape): Point[] {
  const transform = editor.getShapePageTransform(shape);
  return shape.props.segments.flatMap((segment) =>
    b64Vecs.decodePoints(segment.path, segment.dim).map((point) => transform.applyToPoint(point)),
  );
}

function fadeAndDelete(editor: Editor, shape: TLDrawShape, duration: number) {
  dismissStroke(editor, shape, duration);
}

// Feedback is a separate transient shape so undo restores the target without
// bringing the erase gesture back. Keep its animation outside history.
function showStrokeFeedback(editor: Editor, stroke: TLDrawShape, color: "yellow" | "red", duration: number) {
  const current = editor.getShape(stroke.id);
  if (!current || current.type !== "draw") return;
  if (duration === 0) { dismissStroke(editor, current, 0); return; }
  const feedback = { ...current, meta: { ...current.meta, magicPenFeedback: true }, id: createShapeId(), opacity: 1, props: { ...current.props, color } };
  editor.run(() => {
    editor.deleteShape(stroke.id);
    editor.createShape(feedback);
  }, { history: "ignore" });
  dismissStroke(editor, feedback, duration);
}

function rejectStroke(editor: Editor, stroke: TLDrawShape, duration: number) {
  showStrokeFeedback(editor, stroke, "yellow", duration);
}

function fixedShapeStyle(shape: TLShape): TLShape {
  if (shape.type === "geo" && (shape.props.color !== SHAPE_BLUE || shape.props.fill !== "solid")) {
    return { ...shape, props: { ...shape.props, color: SHAPE_BLUE, fill: "solid" } };
  }
  if (shape.type === "arrow" && shape.props.color !== BLUE) {
    return { ...shape, props: { ...shape.props, color: BLUE } };
  }
  return shape;
}

function selectMagicPen(editor: Editor) {
  editor.setCurrentTool(MAGIC_TOOL_ID);
  editor.setStyleForNextShapes(DefaultColorStyle, BLUE);
}

function createRecognizedShape(editor: Editor, stroke: TLDrawShape, recognition: Recognition, points: Point[], duration: number) {
  const box = bounds(points);
  const common = { color: SHAPE_BLUE, fill: "solid" as const, dash: "solid" as const, size: "m" as const };

  if (recognition.label === "rectangle") {
    editor.createShape({
      id: createShapeId(),
      type: "geo",
      x: box.minX,
      y: box.minY,
      rotation: 0,
      props: { ...common, geo: "rectangle", w: box.w, h: box.h },
      meta: { magicPen: recognition.label, confidence: recognition.confidence },
    });
  } else if (recognition.label === "circle") {
    // Snap near-round outlines locally, after recognition. Preserve the
    // center and average diameter; clearly elongated outlines stay oval.
    const nearlyRound = Math.max(box.w, box.h) / Math.min(box.w, box.h) <= 1.25;
    const diameter = (box.w + box.h) / 2;
    const width = nearlyRound ? diameter : box.w;
    const height = nearlyRound ? diameter : box.h;
    editor.createShape({
      id: createShapeId(),
      type: "geo",
      x: box.minX + (box.w - width) / 2,
      y: box.minY + (box.h - height) / 2,
      props: { ...common, geo: "ellipse", w: width, h: height },
      meta: { magicPen: recognition.label, confidence: recognition.confidence },
    });
  } else {
    const { start, end } = strokeEndpoints(points);
    const arrowId = createShapeId();
    editor.createShape({
      id: arrowId,
      type: "arrow",
      x: start.x,
      y: start.y,
      props: {
        ...common,
        color: BLUE,
        start: { x: 0, y: 0 },
        end: { x: end.x - start.x, y: end.y - start.y },
        arrowheadStart: "none",
        arrowheadEnd: "none",
        bend: 0,
      },
      meta: { magicPen: recognition.label, confidence: recognition.confidence },
    });
    const connections = bindArrowTips(editor, arrowId, { start, end }, stroke.id);
    if (connections || recognition.label === "arc") {
      // The stroke's final point is the release end, regardless of direction.
      editor.updateShape({ id: arrowId, type: "arrow", props: {
        arrowheadEnd: connections ? "arrow" : "none",
        bend: connections && recognition.label === "arc" ? arcBend(points) : 0,
      }, meta: { magicPen: connections ? recognition.label : "line", confidence: recognition.confidence } });
    }
  }
  fadeAndDelete(editor, stroke, duration);
}

async function recognize(points: Point[], contextShaft?: Shaft, onCall?: (call: CallTiming) => void): Promise<Recognition> {
  // Quick flicks can contain only two or three pointer samples. Densify
  // those for the API while retaining the original attachment points.
  const evidence = points.length < 4 ? points.slice(1).flatMap((end, i) => [points[i],
    { x: points[i].x + (end.x - points[i].x) / 3, y: points[i].y + (end.y - points[i].y) / 3 },
    { x: points[i].x + (end.x - points[i].x) * 2 / 3, y: points[i].y + (end.y - points[i].y) * 2 / 3 },
  ]).concat([points.at(-1)!]) : points;
  let apiMs: number | null = null;
  let costUsd: number | null = null;
  try {
    const response = await fetch("/api/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: evidence, contextStrokes: contextShaft ? arrowPaths(contextShaft) : undefined,
        contextConnector: contextShaft ? { hasStart: contextShaft.hasStart, hasEnd: contextShaft.hasEnd } : undefined }),
    });
    const result = await response.json();
    apiMs = Number.isFinite(result.apiLatencyMs) ? result.apiLatencyMs : null;
    costUsd = Number.isFinite(result.estimatedCostUsd) && result.estimatedCostUsd >= 0 ? result.estimatedCostUsd : null;
    if (!response.ok) throw new Error(result.error ?? "Recognition failed.");
    return result as Recognition;
  } finally { onCall?.({ apiMs, costUsd, receivedAt: performance.now() }); }
}

function getShaft(editor: Editor, arrow: TLArrowShape): Shaft | null {
  const info = getArrowInfo(editor, arrow);
  if (!info?.isValid || info.type === "elbow") return null;
  const transform = editor.getShapePageTransform(arrow);
  const start = transform.applyToPoint(info.start.point), end = transform.applyToPoint(info.end.point);
  let path: Point[] | undefined;
  if (info.type === "arc") {
    const { center, radius, size } = info.bodyArc;
    const angle = Math.atan2(info.start.point.y - center.y, info.start.point.x - center.x);
    const samples = Math.max(24, Math.min(256, Math.ceil(Math.abs(size) * radius * editor.getZoomLevel() / 4)));
    path = Array.from({ length: samples + 1 }, (_, i) => transform.applyToPoint({
      x: center.x + radius * Math.cos(angle + size * i / samples),
      y: center.y + radius * Math.sin(angle + size * i / samples),
    }));
    path[0] = start; path[path.length - 1] = end;
  }
  return { start, end, path, hasStart: arrow.props.arrowheadStart !== "none", hasEnd: arrow.props.arrowheadEnd !== "none" };
}

const shaftKey = (shaft: Shaft | null) => JSON.stringify(shaft);
type ScratchTarget = { shape: TLShape; terminal?: "start" | "end"; shaft?: Shaft };

function findArrowCandidates(editor: Editor, points: Point[]) {
  // Bounding-box overlap only triggers the contextual classifier. Decisions
  // determines actual contact, edit intent, and which endpoint to change.
  return editor.getCurrentPageShapesSorted().flatMap((shape, layer) => {
    if (shape.type !== "arrow" || shape.isLocked || editor.isShapeHidden(shape)) return [];
    const shaft = getShaft(editor, shape);
    if (!shaft || !boundsOverlap(points, arrowPaths(shaft).flat(), 12 / editor.getZoomLevel())) return [];
    return [{ shape, shaft, layer }];
  }).sort((a, b) => b.layer - a.layer);
}

function findScratchTargets(editor: Editor, stroke: TLDrawShape, points: Point[]): ScratchTarget[] {
  return collectScratchShapes(editor, points, stroke.id).map((shape) => ({
    shape, ...(shape.type === "arrow" ? { shaft: getShaft(editor, shape) ?? undefined } : {}),
  }));
}

function isTargetCurrent(editor: Editor, target: ScratchTarget) {
  return editor.getShape(target.shape.id) === target.shape &&
    (!target.shaft || target.shape.type !== "arrow" || shaftKey(getShaft(editor, target.shape)) === shaftKey(target.shaft));
}

function applyScratch(editor: Editor, stroke: TLDrawShape, targets: ScratchTarget[], duration: number) {
  showStrokeFeedback(editor, stroke, "red", duration);
  editor.markHistoryStoppingPoint("Scratch out");
  const currentTargets = targets.filter((target) => isTargetCurrent(editor, target));
  editor.run(() => {
    // All objects beneath a scratch are one undoable edit. Head-only edits
    // deliberately pass only their arrow, preserving every object below it.
    for (const target of currentTargets) {
      if (target.terminal && target.shape.type === "arrow" && target.shaft) {
        editor.updateShape({ id: target.shape.id, type: "arrow",
          props: { [target.terminal === "start" ? "arrowheadStart" : "arrowheadEnd"]: "none" } });
      } else editor.deleteShape(target.shape.id);
    }
  });
}

type AppProps = { onEditor?: (editor: Editor) => void };

function MagicPenCanvas({ onEditor }: AppProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [latencies, setLatencies] = useState<LatencyRow[]>([]);
  const releases = useRef(new Map<string, number>());

  useEffect(() => {
    if (!editor) return;
    selectMagicPen(editor);
    const removeCreateStyle = editor.store.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
      const styled = fixedShapeStyle(shape);
      if (styled.type === "draw" && styled.props.isComplete && !styled.meta.magicPenFeedback) {
        releases.current.set(styled.id, performance.now());
      }
      return styled.type === "draw" && !styled.meta.magicPenFeedback && editor.getCurrentToolId() === MAGIC_TOOL_ID
        ? { ...styled, props: { ...styled.props, color: BLUE } } : styled;
    });
    const removeChangeStyle = editor.store.sideEffects.registerBeforeChangeHandler("shape", (previous, next) => {
      if (previous.type === "draw" && next.type === "draw" && !previous.props.isComplete && next.props.isComplete && !next.meta.magicPenFeedback) {
        if (!releases.current.has(next.id)) releases.current.set(next.id, performance.now());
      }
      return fixedShapeStyle(next);
    });
    editor.run(() => editor.updateShapes(editor.getCurrentPageShapes().map(fixedShapeStyle)), { history: "ignore" });
    const seen = new Set<string>();
    let disposed = false;
    let queue = Promise.resolve();

    async function processStroke(stroke: TLDrawShape, pageId: string, releasedAt: number) {
      if (disposed || !editor) return;
      const isCurrent = () => !disposed && editor.getCurrentPageId() === pageId && editor.getShape(stroke.id)?.type === "draw";
      if (!isCurrent()) { seen.delete(stroke.id); return; }
      const points = getStrokePoints(editor, stroke);
      if (points.length < 2) { rejectStroke(editor, stroke, STROKE_FADE_MS); return; }
      const calls: CallTiming[] = [];
      const onCall = (call: CallTiming) => calls.push(call);
      let applied = false;
      try {
        const targets = findScratchTargets(editor, stroke, points);
        const candidates = findArrowCandidates(editor, points);
        // Each overlapping connector is shown with the actual new gesture.
        // Shape/scratch recognition and connector edit checks run in parallel.
        const [primary, ...contextual] = await Promise.allSettled([
          recognize(points, undefined, onCall),
          ...candidates.map((candidate) => recognize(points, candidate.shaft, onCall)),
        ]);
        if (primary.status === "rejected") throw primary.reason;
        const standalone = primary.value;
        const results = contextual.map((result) => result.status === "fulfilled" ? result.value : null);
        if (!isCurrent()) { seen.delete(stroke.id); return; }
        applied = true;
        const edits = candidates.flatMap((candidate, i) => {
          if (!isTargetCurrent(editor, candidate)) return [];
          const result = results[i];
          if (!result) return [];
          const accepted = acceptedArrowEdit(candidate.shaft, result);
          return accepted ? [{ candidate, edit: accepted.kind, terminal: accepted.terminal }] : [];
        });
        // An explicit head addition takes priority over scratch classification.
        // No local crossing/reversal heuristic can delete this gesture first.
        const addition = edits.find(({ edit }) => edit.startsWith("add_"));
        if (addition) {
          const { candidate, terminal } = addition;
          editor.updateShape({ id: candidate.shape.id, type: "arrow",
            props: { [terminal === "start" ? "arrowheadStart" : "arrowheadEnd"]: "arrow" } });
          fadeAndDelete(editor, stroke, STROKE_FADE_MS);
          return;
        }
        const headEdits = edits.filter(({ edit }) => edit === "delete_head");
        if (headEdits.length) {
          applyScratch(editor, stroke, headEdits.map(({ candidate, terminal }) => ({ ...candidate, terminal: terminal! })), STROKE_FADE_MS);
          return;
        }
        const scratch = (standalone.scratchOutProbability ?? 0) >= 0.85;
        const deletions = edits.filter(({ edit }) => edit === "delete_arrow").map(({ candidate }) => candidate);
        if (scratch || deletions.length) {
          // Shape deletion still uses the standalone scratch classifier. Every
          // connector must have its own accepted delete_arrow decision; a
          // standalone scribble can never guess which head to remove.
          const shapeTargets = scratch ? targets.filter((target) => target.shape.type !== "arrow") : [];
          applyScratch(editor, stroke, [...shapeTargets, ...deletions], STROKE_FADE_MS);
          return;
        }
        const result = standalone;
        if (result && result.label !== "none" && (result.confidence ?? 0) >= MIN_CONFIDENCE) {
          createRecognizedShape(editor, stroke, result, points, STROKE_FADE_MS);
        } else rejectStroke(editor, stroke, STROKE_FADE_MS);
      } catch {
        if (isCurrent()) { rejectStroke(editor, stroke, STROKE_FADE_MS); applied = true; }
      } finally {
        if (applied && calls.length) {
          // All parallel checks share the moment their stroke's result was applied.
          const uxMs = Math.round(performance.now() - releasedAt);
          const rows = calls.sort((a, b) => b.receivedAt - a.receivedAt).map(({ apiMs, costUsd }) => ({ apiMs, costUsd, uxMs }));
          setLatencies((previous) => [...rows, ...previous].slice(0, 3));
        }
      }
    }

    const interval = window.setInterval(() => {
      for (const shape of editor.getCurrentPageShapes()) {
        if (shape.type !== "draw" || !shape.props.isComplete || shape.props.color !== BLUE || shape.meta.magicPenFeedback || seen.has(shape.id)) continue;
        const stroke = shape as TLDrawShape;
        const pageId = editor.getCurrentPageId();
        seen.add(shape.id);
        const releasedAt = releases.current.get(shape.id) ?? performance.now();
        releases.current.delete(shape.id);
        // Queue recognition in drawing order. A quickly drawn second head can
        // then see the shaft created by the still-pending first request.
        queue = queue.then(() => processStroke(stroke, pageId, releasedAt));
      }
    }, 90);
    return () => { disposed = true; window.clearInterval(interval); removeCreateStyle(); removeChangeStyle(); releases.current.clear(); };
  }, [editor]);

  return (
    <div className="canvas-shell" onPointerUpCapture={() => {
      if (!editor || editor.getCurrentToolId() !== MAGIC_TOOL_ID) return;
      const releasedAt = performance.now();
      for (const shape of editor.getCurrentPageShapes()) {
        if (shape.type === "draw" && !shape.props.isComplete && !shape.meta.magicPenFeedback) releases.current.set(shape.id, releasedAt);
      }
    }}>
      <Tldraw
        themes={CANVAS_THEMES}
        tools={[MagicPenTool]}
        overrides={uiOverrides}
        onMount={(nextEditor) => {
          setEditor(nextEditor);
          selectMagicPen(nextEditor);
          onEditor?.(nextEditor);
        }}
      />
      <table className="latency-display" aria-label="Last three recognition calls, newest first"
        title="API: OpenAI send/receive only. UX: stroke release to applied result, including queue and network time; excludes the 75 ms fade. Parallel checks share UX time. Est. USD: returned input tokens at Decisions pricing ($0.10/million), not a billed amount. A dash means the timing or estimate is unavailable.">
        <thead><tr><th>API ms</th><th>UX ms</th><th>Est. USD</th></tr></thead>
        <tbody>{Array.from({ length: 3 }, (_, i) => <tr key={i}>
          <td>{latencies[i]?.apiMs ?? "—"}</td><td>{latencies[i]?.uxMs ?? "—"}</td>
          <td>{latencies[i]?.costUsd != null ? `$${latencies[i].costUsd.toFixed(7)}` : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

export function App(props: AppProps = {}) {
  return <MagicPenCanvas {...props} />;
}
