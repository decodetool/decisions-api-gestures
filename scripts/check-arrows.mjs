import { contextForStroke } from "./arrow-evidence.mjs";
import { polyline } from "./check-shapes.mjs";
const line = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
const fullRightHead = [{ x: 176, y: -16 }, { x: 200, y: 0 }, { x: 176, y: 16 }];
const cases = [
  { name: "add right barb to line", expected: "arrow", points: polyline([[170, -30], [200, 0]]), contextStrokes: [line] },
  { name: "add left barb to line", expected: "arrow", points: polyline([[30, -30], [0, 0]]), contextStrokes: [line] },
  { name: "add left barb to right arrow", expected: "double_arrow", points: polyline([[30, -30], [0, 0]]), contextStrokes: [line, fullRightHead] },
  { name: "add full head to right arrow", expected: "double_arrow", points: polyline([[30, -30], [0, 0], [30, 30]]), contextStrokes: [line, fullRightHead] },
  { name: "isolated V is not an arrow", expected: "none", points: polyline([[30, -30], [0, 0], [30, 30]]) },
];
for (const c of cases) {
  const response = await fetch("http://127.0.0.1:5178/api/recognize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: c.points, contextStrokes: contextForStroke(c.points, c.contextStrokes) }) });
  const r = await response.json();
  const addedHead = c.contextStrokes && r.headAdditionProbability >= 0.65;
  const upgradedLabel = addedHead ? c.contextStrokes.length > 1 ? "double_arrow" : "arrow" : r.label;
  const passed = upgradedLabel === c.expected && (c.expected === "none" || addedHead || r.confidence >= 0.6);
  console.log(JSON.stringify({ name: c.name, expected: c.expected, label: upgradedLabel, headAdditionProbability: r.headAdditionProbability, confidence: r.confidence, passed, latencyMs: r.latencyMs, error: r.error }));
  if (!passed) process.exitCode = 1;
}
