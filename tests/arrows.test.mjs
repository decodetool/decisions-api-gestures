import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { strokeEndpoints, arrowPaths, arcBend, boundsOverlap, acceptedArrowEdit } from "../src/arrow-geometry.ts";
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

test("Decisions chooses both action and endpoint; no geometry selects the other end", () => {
  const decision = (connectorEdit, connectorEditProbability = 0.98) => ({ connectorEdit, connectorEditProbability });
  assert.deepEqual(acceptedArrowEdit(line, decision("add_tail")), { kind: "add_head", terminal: "start" });
  assert.deepEqual(acceptedArrowEdit(line, decision("add_head")), { kind: "add_head", terminal: "end" });
  const arrow = { ...line, hasEnd: true };
  assert.deepEqual(acceptedArrowEdit(arrow, decision("delete_head")), { kind: "delete_head", terminal: "end" });
  assert.deepEqual(acceptedArrowEdit({ ...arrow, hasStart: true }, decision("delete_tail")), { kind: "delete_head", terminal: "start" });
  assert.deepEqual(acceptedArrowEdit(arrow, decision("delete_arrow")), { kind: "delete_arrow" });
  assert.equal(acceptedArrowEdit(arrow, decision("add_head")), null);
  assert.equal(acceptedArrowEdit(arrow, decision("delete_tail")), null);
  assert.equal(acceptedArrowEdit(arrow, decision("delete_arrow", 0.64)), null);
  assert.equal(acceptedArrowEdit(line, decision("add_tail", 0.59)), null);
  assert.equal(acceptedArrowEdit(arrow, decision("keep")), null);
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
