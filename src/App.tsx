import { useEffect, useState } from "react";
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
import { strokeEndpoints, arrowPaths, arrowEvidencePaths, arcBend, boundsOverlap, segmentDistance, acceptedArrowEdit, nearestBareEnd, type ArrowEditEvidence, type Point, type Shaft } from "./arrow-geometry";

import { collectScratchShapes } from "./erase-targets";
import { bindArrowTips } from "./connections";
import { arrowEraseHit } from "./scratch-geometry";

const MAGIC_TOOL_ID = "magic-pen";
const BLUE = "blue" as const;
const MIN_CONFIDENCE = 0.6;
const SHAPE_BLUE = "light-blue" as const;

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

function fadeAndDelete(editor: Editor, shape: TLDrawShape) {
  editor.updateShape({ id: shape.id, type: "draw", opacity: 0.55, meta: { ...shape.meta, magicPenFeedback: true } });
  window.setTimeout(() => editor.updateShape({ id: shape.id, type: "draw", opacity: 0.1 }), 180);
  window.setTimeout(() => editor.deleteShape(shape.id), 520);
}

// Feedback is a separate transient shape so undo restores the target without
// bringing the erase gesture back. Keep its animation outside history.
function showStrokeFeedback(editor: Editor, stroke: TLDrawShape, color: "yellow" | "red") {
  const current = editor.getShape(stroke.id);
  if (!current || current.type !== "draw") return;
  const feedback = { ...current, meta: { ...current.meta, magicPenFeedback: true }, id: createShapeId(), opacity: 1, props: { ...current.props, color } };
  editor.run(() => {
    editor.deleteShape(stroke.id);
    editor.createShape(feedback);
  }, { history: "ignore" });
  window.setTimeout(() => editor.run(() => editor.updateShape({ id: feedback.id, type: "draw", opacity: 0.5 }), { history: "ignore" }), 400);
  window.setTimeout(() => editor.run(() => editor.deleteShape(feedback.id), { history: "ignore" }), 750);
}

function rejectStroke(editor: Editor, stroke: TLDrawShape) {
  showStrokeFeedback(editor, stroke, "yellow");
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

function createRecognizedShape(editor: Editor, stroke: TLDrawShape, recognition: Recognition, points: Point[]) {
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
  fadeAndDelete(editor, stroke);
}

async function recognize(points: Point[], contextStrokes?: Point[][]): Promise<Recognition> {
  // Quick flicks can contain only two or three pointer samples. Densify
  // those for the API while retaining the original attachment points.
  const evidence = points.length < 4 ? points.slice(1).flatMap((end, i) => [points[i],
    { x: points[i].x + (end.x - points[i].x) / 3, y: points[i].y + (end.y - points[i].y) / 3 },
    { x: points[i].x + (end.x - points[i].x) * 2 / 3, y: points[i].y + (end.y - points[i].y) * 2 / 3 },
  ]).concat([points.at(-1)!]) : points;
  const response = await fetch("/api/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points: evidence, contextStrokes }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<Recognition>;
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

function findArrowCandidates(editor: Editor, stroke: TLDrawShape, points: Point[]) {
  const shapes = editor.getCurrentPageShapesSorted();
  const layers = new Map(shapes.map((shape, i) => [shape.id, i]));
  return shapes.flatMap((shape, layer) => {
    if (shape.type !== "arrow" || shape.isLocked || editor.isShapeHidden(shape)) return [];
    const shaft = getShaft(editor, shape);
    if (!shaft || !boundsOverlap(points, arrowPaths(shaft).flat(), 12 / editor.getZoomLevel())) return [];
    const hit = arrowEraseHit(points, shaft, editor.getZoomLevel());
    const visibleHeadHit = arrowEraseHit(points, shaft, editor.getZoomLevel(), (point) => {
      const top = editor.getShapeAtPoint(point, { hitInside: true, hitLabels: true,
        filter: (shape) => shape.id !== stroke.id && shape.type !== "draw" });
      return !top || (layers.get(top.id) ?? -1) <= layer;
    });
    const distance = Math.min(...points.map((p) => Math.min(...arrowPaths(shaft).flatMap((path) =>
      path.slice(1).map((end, i) => segmentDistance(p, path[i], end))))));
    return [{ shape, shaft, hit, visibleHeadHit, distance, layer }];
  }).sort((a, b) => a.distance - b.distance || b.layer - a.layer);
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

function applyScratch(editor: Editor, stroke: TLDrawShape, targets: ScratchTarget[]) {
  showStrokeFeedback(editor, stroke, "red");
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

  useEffect(() => {
    if (!editor) return;
    selectMagicPen(editor);
    const removeCreateStyle = editor.store.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
      const styled = fixedShapeStyle(shape);
      return styled.type === "draw" && !styled.meta.magicPenFeedback && editor.getCurrentToolId() === MAGIC_TOOL_ID
        ? { ...styled, props: { ...styled.props, color: BLUE } } : styled;
    });
    const removeChangeStyle = editor.store.sideEffects.registerBeforeChangeHandler("shape", (_previous, next) => fixedShapeStyle(next));
    editor.run(() => editor.updateShapes(editor.getCurrentPageShapes().map(fixedShapeStyle)), { history: "ignore" });
    const seen = new Set<string>();
    let disposed = false;
    let queue = Promise.resolve();

    async function processStroke(stroke: TLDrawShape, pageId: string) {
      if (disposed || !editor) return;
      const isCurrent = () => !disposed && editor.getCurrentPageId() === pageId && editor.getShape(stroke.id)?.type === "draw";
      if (!isCurrent()) { seen.delete(stroke.id); return; }
      const points = getStrokePoints(editor, stroke);
      if (points.length < 2) { rejectStroke(editor, stroke); return; }
      try {
        const targets = findScratchTargets(editor, stroke, points);
        const candidates = findArrowCandidates(editor, stroke, points);
        // Each overlapping connector is shown with the actual new gesture.
        // Shape/scratch recognition and connector edit checks run in parallel.
        const [standalone, contextual] = await Promise.all([
          recognize(points),
          Promise.allSettled(candidates.map((candidate) => recognize(points, arrowEvidencePaths(candidate.shaft, points, editor!.getZoomLevel())))),
        ]);
        const results = contextual.map((result) => result.status === "fulfilled" ? result.value : null);
        if (!isCurrent()) { seen.delete(stroke.id); return; }
        const edits = candidates.flatMap((candidate, i) => {
          if (!isTargetCurrent(editor, candidate)) return [];
          const result = results[i];
          if (!result) return [];
          const bareEnd = nearestBareEnd(points, candidate.shaft, 18 / editor!.getZoomLevel());
          const edit = acceptedArrowEdit(candidate.shaft, { ...result, headAdditionProbability: bareEnd ? result.headAdditionProbability : 0,
            headCrossingProbability: candidate.visibleHeadHit?.terminal ? result.headCrossingProbability : 0 });
          if (!edit) return [];
          const terminal = edit === "add_head" ? bareEnd
            : edit === "delete_head" ? candidate.visibleHeadHit?.terminal : undefined;
          if ((edit === "add_head" || edit === "delete_head") && !terminal) return [];
          if (edit === "delete_arrow" && !candidate.hit) return [];
          return [{ candidate, edit, terminal }];
        });
        // An explicit head addition takes priority over scratch classification.
        // No local crossing/reversal heuristic can delete this gesture first.
        const addition = edits.find(({ edit }) => edit.startsWith("add_"));
        if (addition) {
          const { candidate, terminal } = addition;
          editor.updateShape({ id: candidate.shape.id, type: "arrow",
            props: { [terminal === "start" ? "arrowheadStart" : "arrowheadEnd"]: "arrow" } });
          fadeAndDelete(editor, stroke);
          return;
        }
        const headEdits = edits.filter(({ edit }) => edit === "delete_head");
        if (headEdits.length) {
          applyScratch(editor, stroke, headEdits.map(({ candidate, terminal }) => ({ ...candidate, terminal: terminal! })));
          return;
        }
        const scratch = (standalone.scratchOutProbability ?? 0) >= 0.85;
        if (scratch) {
          const headHits = candidates.filter((candidate) => candidate.visibleHeadHit?.terminal && isTargetCurrent(editor, candidate));
          if (headHits.length) {
            applyScratch(editor, stroke, headHits.map((candidate) => ({ ...candidate, terminal: candidate.visibleHeadHit!.terminal })));
          } else {
            for (const candidate of candidates) {
              if (candidate.hit && !targets.some((target) => target.shape.id === candidate.shape.id)) targets.push(candidate);
            }
            applyScratch(editor, stroke, targets);
          }
          return;
        }
        const deletions = edits.filter(({ edit }) => edit === "delete_arrow");
        if (deletions.length) {
          applyScratch(editor, stroke, deletions.map(({ candidate }) => candidate));
          return;
        }
        const result = standalone;
        if (result && result.label !== "none" && (result.confidence ?? 0) >= MIN_CONFIDENCE) {
          createRecognizedShape(editor, stroke, result, points);
        } else rejectStroke(editor, stroke);
      } catch {
        if (isCurrent()) rejectStroke(editor, stroke);
      }
    }

    const interval = window.setInterval(() => {
      for (const shape of editor.getCurrentPageShapes()) {
        if (shape.type !== "draw" || !shape.props.isComplete || shape.props.color !== BLUE || shape.meta.magicPenFeedback || seen.has(shape.id)) continue;
        const stroke = shape as TLDrawShape;
        const pageId = editor.getCurrentPageId();
        seen.add(shape.id);
        // Queue recognition in drawing order. A quickly drawn second head can
        // then see the shaft created by the still-pending first request.
        queue = queue.then(() => processStroke(stroke, pageId));
      }
    }, 90);
    return () => { disposed = true; window.clearInterval(interval); removeCreateStyle(); removeChangeStyle(); };
  }, [editor]);

  return (
    <div className="canvas-shell">
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
    </div>
  );
}

export function App(props: AppProps = {}) {
  return <MagicPenCanvas {...props} />;
}
