import test from "node:test";
import assert from "node:assert/strict";
import { orientConnectorPaths, renderStrokeImage } from "../lib/stroke-image.mjs";

const paths = [
  [{ x: 0, y: 0 }, { x: 50, y: -40 }, { x: 150, y: -40 }, { x: 200, y: 0 }],
  [{ x: 176, y: -16 }, { x: 200, y: 0 }, { x: 176, y: 16 }],
  [{ x: 30, y: -30 }, { x: 0, y: -8 }, { x: 30, y: 30 }],
];

test("rotation puts original start at bottom and end at top, preserving every curve/gesture point", () => {
  const oriented = orientConnectorPaths(paths);
  assert.deepEqual(oriented[0][0], { x: 0, y: 100 });
  assert.deepEqual(oriented[0].at(-1), { x: 0, y: -100 });
  assert.deepEqual(oriented[0][1], { x: -40, y: 50 });
  assert.deepEqual(oriented[2][1], { x: -8, y: 100 });
  assert.deepEqual(oriented.map((p) => p.length), paths.map((p) => p.length));
  assert.throws(() => orientConnectorPaths([[{ x: 0, y: 0 }, { x: 0, y: 0 }]]), /Invalid connector/);
});

test("connector raster is identical across rotation and translation, including both endpoints", async () => {
  const expected = await renderStrokeImage(paths.at(-1), paths.slice(0, -1));
  for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const rotated = paths.map((path) => path.map(({ x, y }) => ({
      x: x * Math.cos(angle) - y * Math.sin(angle) + 500,
      y: x * Math.sin(angle) + y * Math.cos(angle) - 300,
    })));
    assert.equal(await renderStrokeImage(rotated.at(-1), rotated.slice(0, -1)), expected);
  }
});
