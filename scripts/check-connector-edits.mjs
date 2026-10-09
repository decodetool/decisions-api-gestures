import { arrowPaths, acceptedArrowEdit } from "../src/arrow-geometry.ts";
import { contextForStroke } from "./arrow-evidence.mjs";
import { polyline } from "./check-shapes.mjs";

const line = { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, hasStart: true, hasEnd: true };
const arc = { ...line, path: Array.from({ length: 81 }, (_, i) => ({ x: i * 2.5, y: -60 * Math.sin(i / 80 * Math.PI) })) };
const cases = [
  ...[0, Math.PI / 2, Math.PI, -Math.PI / 3].flatMap((angle) => [
    { name: `delete tail, rotation ${angle}`, expected: "delete_tail", shaft: line, angle, points: polyline([[2, -25], [2, 25]]) },
    { name: `delete head, rotation ${angle}`, expected: "delete_head", shaft: line, angle, points: polyline([[198, -25], [198, 25]]) },
  ]),
  { name: "delete curved body", expected: "delete_arrow", shaft: arc, points: polyline([[100, -70], [100, -50]]) },
  { name: "chord crossing does not erase arc", expected: "keep", shaft: arc, points: polyline([[100, -10], [100, 10]]) },
  { name: "delete curved tail", expected: "delete_tail", shaft: arc, points: polyline([[-15, 0], [15, 0]]) },
  { name: "add single barb to curved tail", expected: "add_tail", shaft: { ...arc, hasStart: false }, points: arrowPaths(arc)[1].slice(0, 2) },
  { name: "add single barb to curved head", expected: "add_head", shaft: { ...arc, hasEnd: false }, points: arrowPaths(arc)[2].slice(0, 2) },
];
for (const c of cases) {
  const angle = c.angle ?? 0;
  const rotate = (path) => path.map(({ x, y }) => ({ x: x * Math.cos(angle) - y * Math.sin(angle) + 300, y: x * Math.sin(angle) + y * Math.cos(angle) - 200 }));
  const points = rotate(c.points), context = arrowPaths(c.shaft).map(rotate);
  const response = await fetch("http://127.0.0.1:5178/api/recognize", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, ...contextForStroke(points, context) }) });
  const result = await response.json();
  const accepted = acceptedArrowEdit(c.shaft, result);
  const observed = accepted ? result.connectorEdit : "keep";
  const passed = response.ok && observed === c.expected;
  console.log(JSON.stringify({ name: c.name, expected: c.expected, observed, probability: result.connectorEditProbability, probabilities: result.editProbabilities, passed, error: result.error }));
  if (!passed) process.exitCode = 1;
}
