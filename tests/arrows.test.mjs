import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { strokeEndpoints, arrowPaths, arrowEvidencePaths, arcBend, boundsOverlap, acceptedArrowEdit, nearestBareEnd } from "../src/arrow-geometry.ts";
import { renderStrokeImage } from "../lib/stroke-image.mjs";
import { polyline } from "../scripts/check-shapes.mjs";

const line = { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, hasStart: false, hasEnd: false };

test("curved lines retain the actual first and last stroke points in either direction", () => {
  const points = polyline([[155, 300], [205, 250], [345, 340], [450, 300]]);
  assert.deepEqual(strokeEndpoints(points), { start: { x: 155, y: 300 }, end: { x: 450, y: 300 } });
  assert.deepEqual(strokeEndpoints([...points].reverse()), { start: { x: 450, y: 300 }, end: { x: 155, y: 300 } });
});

test("a curved or hooked ending never gets replaced with a guessed shaft junction", () => {
  const points = polyline([[0, 0], [200, 0], [185, 20], [180, 25]]);
  assert.deepEqual(strokeEndpoints(points), { start: line.start, end: { x: 180, y: 25 } });
});

test("separate context paths stay separate rather than gaining artificial connectors", async () => {
  const png = await renderStrokeImage(polyline([[0, 100], [200, 100]]), [[line.start, line.end]]);
  const { data, info } = await sharp(Buffer.from(png.split(",")[1], "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const center = (128 * info.width + 128) * info.channels;
  assert.deepEqual([...data.subarray(center, center + 3)], [255, 255, 255]);
  assert.equal(arrowPaths({ ...line, hasEnd: true }).length, 2);
  assert.equal(arrowPaths({ ...line, hasStart: true, hasEnd: true }).length, 3);
});

test("Decisions predicates control edits, with head addition taking priority over deletion", () => {
  const arrow = { ...line, hasEnd: true };
  assert.equal(acceptedArrowEdit(line, { headAdditionProbability: 0.98, shaftCrossingProbability: 0.99 }), "add_head");
  assert.equal(acceptedArrowEdit(line, { shaftCrossingProbability: 0.5 }), null);
  assert.equal(acceptedArrowEdit(line, { headCrossingProbability: 0.99 }), null);
  assert.equal(acceptedArrowEdit({ ...arrow, hasStart: true }, { headAdditionProbability: 0.99 }), null);
  assert.equal(acceptedArrowEdit(arrow, { headCrossingProbability: 0.99 }), "delete_head");
  assert.equal(acceptedArrowEdit(arrow, { shaftCrossingProbability: 0.99 }), "delete_arrow");
  assert.equal(nearestBareEnd(polyline([[170, -30], [200, 0]]), line, 18), "end");
  assert.equal(nearestBareEnd(polyline([[170, -30], [200, 0]]), arrow, 18), null);
  assert.equal(nearestBareEnd(polyline([[30, -30], [0, 0]]), arrow, 18), "start");
  assert.equal(nearestBareEnd([line.start, line.end], line, 18), null);
  assert.equal(acceptedArrowEdit(line, {}), null);
});

test("arc bend follows the dominant side, maximum sagitta, reverse direction and rotation", () => {
  const arc = Array.from({ length: 101 }, (_, i) => ({ x: i * 2, y: -60 * Math.sin(i / 100 * Math.PI) }));
  assert.equal(arcBend(arc), -60);
  assert.ok(Math.abs(arcBend([...arc].reverse()) - 60) < 1e-9);
  assert.ok(Math.abs(arcBend(arc.map(({ x, y }) => ({ x: -y + 500, y: x + 300 }))) + 60) < 1e-9);
  assert.equal(arcBend(arc.map(({ x, y }) => ({ x, y: -y }))), 60);
  assert.equal(arcBend([line.start, line.end]), 0);
  assert.equal(arcBend([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]), 0);
  assert.equal(arcBend([{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 50, y: -30 }, { x: 150, y: -40 }, { x: 200, y: 0 }]), -40);
});

test("curved connector evidence uses the body path and heads use endpoint tangents", () => {
  const shaft = { ...line, path: [{ x: 0, y: 0 }, { x: 50, y: -50 }, { x: 150, y: -50 }, { x: 200, y: 0 }], hasEnd: true };
  const paths = arrowPaths(shaft);
  assert.deepEqual(paths[0], shaft.path);
  assert.ok(paths[1][0].y < 0 && paths[1][2].y < 0);
  assert.equal(boundsOverlap(polyline([[90, -60], [110, -40]]), paths.flat(), 0), true);
  assert.equal(boundsOverlap(polyline([[90, 20], [110, 40]]), paths.flat(), 0), false);
});

test("small barb evidence focuses the bare tip and retains its actual curved tangent", () => {
  const shaft = { ...line, hasEnd: true, path: Array.from({ length: 101 }, (_, i) => ({ x: i * 2, y: -60 * Math.sin(i / 100 * Math.PI) })) };
  const points = polyline([[30, -5], [0, 0]]);
  const focused = arrowEvidencePaths(shaft, points, 1);
  assert.equal(focused.length, 1);
  assert.equal(focused[0][0].x, shaft.start.x);
  assert.ok(Math.abs(focused[0][0].y - shaft.start.y) < 1e-9);
  assert.deepEqual(focused[0][1], shaft.path[1]);
  assert.ok(focused[0].at(-1).x < 100);
  const slash = polyline([[100, -80], [100, 0]]);
  assert.deepEqual(arrowEvidencePaths(shaft, slash, 1), arrowPaths(shaft));
});

test("existing-head slash evidence retains that head and excludes the distant other head", () => {
  const shaft = { ...line, hasStart: true, hasEnd: true };
  const focused = arrowEvidencePaths(shaft, polyline([[198, -45], [198, 45]]), 1);
  assert.equal(focused.length, 2);
  assert.equal(focused[0][0].x, 100);
  assert.deepEqual(focused[0].at(-1), line.end);
  assert.deepEqual(focused[1], arrowPaths(shaft)[2]);
});
