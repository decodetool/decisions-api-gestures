import { contextForStroke } from "./arrow-evidence.mjs";
import { polyline } from "./check-shapes.mjs";
const line = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
const fullRightHead = [{ x: 176, y: -16 }, { x: 200, y: 0 }, { x: 176, y: 16 }];
const cases = [
  { name: "add right barb to line", expected: "arrow", points: polyline([[170, -30], [200, 0]]), contextStrokes: [line] },
  { name: "add left barb to line", expected: "arrow", points: polyline([[30, -30], [0, 0]]), contextStrokes: [line] },
  { name: "add left barb to right arrow", expected: "double_arrow", points: polyline([[30, -30], [0, 0]]), contextStrokes: [line, fullRightHead] },
  { name: "add full head to right arrow", expected: "double_arrow", points: polyline([[30, -30], [0, 0], [30, 30]]), contextStrokes: [line, fullRightHead] },
  ...[0, -8, -15].map((offset) => ({ name: `add upward tail V with ${-offset}px edge overlap`, expected: "double_arrow",
    points: polyline([[-30, 130], [0, 100 + offset], [30, 130]]),
    contextStrokes: [[{ x: 0, y: 100 }, { x: 0, y: 300 }], [{ x: -16, y: 276 }, { x: 0, y: 300 }, { x: 16, y: 276 }]] })),
  { name: "add downward tail V", expected: "double_arrow", points: polyline([[-30, 270], [0, 308], [30, 270]]),
    contextStrokes: [[{ x: 0, y: 300 }, { x: 0, y: 100 }], [{ x: -16, y: 124 }, { x: 0, y: 100 }, { x: 16, y: 124 }]] },
  { name: "isolated V is not an arrow", expected: "none", points: polyline([[30, -30], [0, 0], [30, 30]]) },
];
for (const c of cases) {
  const response = await fetch("http://127.0.0.1:5178/api/recognize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: c.points, ...contextForStroke(c.points, c.contextStrokes) }) });
  const r = await response.json();
  const expectedEdit = c.contextStrokes ? c.name.includes("right barb") ? "add_head" : "add_tail" : null;
  const addedHead = c.contextStrokes && r.connectorEdit === expectedEdit && r.connectorEditProbability >= 0.6;
  const upgradedLabel = addedHead ? c.contextStrokes.length > 1 ? "double_arrow" : "arrow" : r.label;
  const passed = upgradedLabel === c.expected && (c.expected === "none" || addedHead || r.confidence >= 0.6);
  console.log(JSON.stringify({ name: c.name, expected: c.expected, label: upgradedLabel, edit: r.connectorEdit, probability: r.connectorEditProbability, confidence: r.confidence, passed, latencyMs: r.latencyMs, error: r.error }));
  if (!passed) process.exitCode = 1;
}
