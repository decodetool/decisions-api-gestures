import test from "node:test";
import assert from "node:assert/strict";
import { bindArrowTips } from "../src/connections.ts";
import { collectScratchShapes, sampleStroke } from "../src/erase-targets.ts";

test("binding makes exactly one topmost point lookup per tip and keeps precise local anchors", () => {
  const arrow = { id: "shape:arrow", type: "arrow" };
  const top = { id: "shape:top", type: "geo" }, end = { id: "shape:end", type: "geo" };
  const lookedUp = [], bindings = [];
  const editor = {
    getShape: () => arrow,
    getZoomLevel: () => 2,
    getShapeAtPoint: (point, options) => {
      lookedUp.push(point);
      assert.equal(options.margin, 0.5);
      assert.equal(options.hitInside, true);
      assert.equal(options.filter({ id: "shape:stroke", type: "draw" }), false);
      assert.equal(options.filter(arrow), false);
      return lookedUp.length === 1 ? top : end;
    },
    canBindShapes: () => true,
    getPointInShapeSpace: (_shape, point) => ({ x: point.x - 100, y: point.y - 200 }),
    getShapeGeometry: () => ({ bounds: { x: 0, y: 0, w: 100, h: 100 } }),
    createBinding: (binding) => bindings.push(binding),
  };
  bindArrowTips(editor, arrow.id, { start: { x: 125, y: 250 }, end: { x: 190, y: 270 } }, "shape:stroke");
  assert.equal(lookedUp.length, 2);
  assert.deepEqual(bindings.map((binding) => binding.toId), [top.id, end.id]);
  assert.deepEqual(bindings[0].props.normalizedAnchor, { x: 0.25, y: 0.5 });
  assert.deepEqual(bindings[1].props.normalizedAnchor, { x: 0.9, y: 0.7 });
  assert.deepEqual(bindings.map((binding) => binding.props.terminal), ["start", "end"]);
});

test("no target at a tip means no binding, with no broad search along the shaft", () => {
  let lookups = 0;
  const editor = { getShape: () => ({ id: "shape:arrow" }), getZoomLevel: () => 1, getShapeAtPoint: () => { lookups++; return undefined; }, createBinding: () => assert.fail("No shape under either tip") };
  bindArrowTips(editor, "shape:arrow", { start: { x: 0, y: 0 }, end: { x: 200, y: 0 } }, "shape:stroke");
  assert.equal(lookups, 2);
});

test("scratch targeting samples actual segments, including crossings between pen points", () => {
  const points = sampleStroke([{ x: 0, y: 0 }, { x: 20, y: 0 }], 4);
  assert.deepEqual(points.map((p) => p.x), [0, 4, 8, 12, 16, 20]);
});

test("scratch targets include every covered layer while excluding locked, hidden and pen strokes", () => {
  const shapes = [
    { id: "shape:top", type: "geo" }, { id: "shape:back", type: "geo" },
    { id: "shape:arrow", type: "arrow" }, { id: "shape:locked", type: "geo", isLocked: true },
    { id: "shape:hidden", type: "geo" }, { id: "shape:stroke", type: "draw" },
  ];
  const editor = {
    getZoomLevel: () => 1,
    isShapeHidden: (shape) => shape.id === "shape:hidden",
    getShapesAtPoint: (point, options) => {
      assert.equal(options.hitInside, true);
      return point.x < 5 ? shapes : [shapes[2]];
    },
  };
  assert.deepEqual(collectScratchShapes(editor, [{ x: 0, y: 0 }, { x: 10, y: 0 }], "shape:stroke").map((shape) => shape.id), ["shape:top", "shape:back", "shape:arrow"]);
});
