import test from "node:test";
import assert from "node:assert/strict";
import { arrowEraseHit } from "../src/scratch-geometry.ts";
import { polyline } from "../scripts/check-shapes.mjs";

const arrow = { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, hasStart: true, hasEnd: true };

test("a single crossing line or tiny scribble hits an arrow without repeated passes", () => {
  assert.equal(arrowEraseHit([{ x: 100, y: -15 }, { x: 100, y: 15 }], arrow, 1).terminal, undefined);
  assert.equal(arrowEraseHit(polyline([[97, -5], [103, 5], [97, 3]]), arrow, 1).terminal, undefined);
  assert.equal(arrowEraseHit([{ x: 100, y: 20 }, { x: 100, y: 40 }], arrow, 1), null);
});

test("contact nearest an existing head identifies that head even for a long slash", () => {
  assert.equal(arrowEraseHit([{ x: 198, y: -80 }, { x: 198, y: 80 }], arrow, 1).terminal, "end");
  assert.equal(arrowEraseHit([{ x: 2, y: -20 }, { x: 2, y: 20 }], arrow, 1).terminal, "start");
  // A touch on a wing alone, away from the shaft, still hits the head.
  assert.equal(arrowEraseHit([{ x: 175, y: 14 }, { x: 180, y: 20 }], arrow, 1).terminal, "end");
  assert.equal(arrowEraseHit([{ x: 175, y: -20 }, { x: 180, y: -14 }], arrow, 1).terminal, "end");
});

test("a stroke covering the shaft identifies the body rather than picking either head", () => {
  assert.equal(arrowEraseHit([{ x: 0, y: 0 }, { x: 200, y: 0 }], arrow, 1).terminal, undefined);
  assert.equal(arrowEraseHit([{ x: 200, y: -20 }, { x: 200, y: 20 }], { ...arrow, hasEnd: false }, 1).terminal, undefined);
});

test("arrow contacts respect occlusion, rotation, and screen-space hit tolerance", () => {
  assert.equal(arrowEraseHit([{ x: 100, y: -10 }, { x: 100, y: 10 }], arrow, 1, () => false), null);
  const rotated = { ...arrow, end: { x: 0, y: 200 } };
  assert.equal(arrowEraseHit([{ x: -30, y: 199 }, { x: 30, y: 199 }], rotated, 1).terminal, "end");
  assert.equal(arrowEraseHit([{ x: 95, y: 4 }, { x: 105, y: 4 }], arrow, 2), null);
  assert.equal(arrowEraseHit([{ x: 95, y: 4 }, { x: 105, y: 4 }], arrow, 1).terminal, undefined);
});

test("arc contacts follow the curve rather than its chord and head wings follow the tangent", () => {
  const shaft = { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, hasStart: false, hasEnd: true,
    path: Array.from({ length: 101 }, (_, i) => ({ x: i * 2, y: -60 * Math.sin(i / 100 * Math.PI) })) };
  assert.equal(arrowEraseHit([{ x: 100, y: -70 }, { x: 100, y: -50 }], shaft, 1).terminal, undefined);
  assert.equal(arrowEraseHit([{ x: 100, y: -10 }, { x: 100, y: 10 }], shaft, 1), null);
  assert.equal(arrowEraseHit([{ x: 197, y: -15 }, { x: 197, y: 15 }], shaft, 1).terminal, "end");
});
