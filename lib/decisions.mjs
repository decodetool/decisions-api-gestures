import { performance } from "node:perf_hooks";
import { estimateDecisionCostUsd } from "./decision-pricing.mjs";

export const labels = ["line", "arc", "rectangle", "circle", "none"];
const criteria = {
  line: "An open mostly straight connector without an arrowhead. Allow small wobbles, hooked ends or an S-curve without a dominant circular bow. It is not a loop or repeated scratch.",
  arc: "An open connector with a clear smooth bow to one side, like part of a circle. It may face any direction and have any radius. No loop, arrowhead or repeated zigzag.",
  rectangle: "A mostly closed, four-sided rectangular or square loop with four dominant corners. Allow gently bowed sides, a small gap, or a short overshoot at the closing corner.",
  circle: "A mostly closed, smooth rounded loop without dominant corners. Allow a small hook, crossover, or short tail at the closing point.",
  none: "Any other stroke, including arrows drawn in one stroke, isolated V arrowheads, triangles, zigzags, or scribbles. Arrowheads are only added in a separate stroke to an existing line.",
};

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resample(points, count = 24) {
  const segments = points.slice(1).map((point, index) => distance(points[index], point));
  const total = segments.reduce((sum, length) => sum + length, 0);
  if (!total) return Array.from({ length: count }, () => points[0]);
  const output = [];
  let segment = 0;
  let traveled = 0;
  for (let index = 0; index < count; index++) {
    const target = (index / (count - 1)) * total;
    while (segment < segments.length - 1 && traveled + segments[segment] < target) {
      traveled += segments[segment++];
    }
    const start = points[segment];
    const end = points[segment + 1];
    const ratio = (target - traveled) / (segments[segment] || 1);
    output.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
  }
  return output;
}

function angleAt(a, b, c) {
  // Compare consecutive travel vectors. Using vectors that both point away
  // from b makes a perfectly straight path look like a 180° turn.
  const left = { x: b.x - a.x, y: b.y - a.y };
  const right = { x: c.x - b.x, y: c.y - b.y };
  const divisor = Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y);
  if (!divisor) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (left.x * right.x + left.y * right.y) / divisor)));
}

export function compactStroke(rawPoints) {
  const points = rawPoints
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    .reduce((accumulator, point) => {
      const previous = accumulator.at(-1);
      if (!previous || distance(previous, point) >= 1.5) accumulator.push({ x: point.x, y: point.y });
      return accumulator;
    }, []);
  if (points.length < 2) throw new Error("Draw a longer stroke.");

  const sampled = resample(points);
  const xs = sampled.map((point) => point.x);
  const ys = sampled.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.max(maxX - minX, maxY - minY, 1);
  const normalized = sampled.map((point) => ({ x: round((point.x - (minX + maxX) / 2) / scale), y: round((point.y - (minY + maxY) / 2) / scale) }));
  const pathLength = normalized.slice(1).reduce((sum, point, index) => sum + distance(normalized[index], point), 0);
  const turns = normalized.slice(1, -1).map((point, index) => angleAt(normalized[index], point, normalized[index + 2]));

  return {
    points: normalized.map((point) => [point.x, point.y]),
    geometry: {
      pointCount: normalized.length,
      pathLength: round(pathLength),
      startEndGap: round(distance(normalized[0], normalized.at(-1))),
      sharpTurnCount: turns.filter((turn) => turn > 0.75).length,
      xSpan: round(Math.max(...normalized.map((point) => point.x)) - Math.min(...normalized.map((point) => point.x))),
      ySpan: round(Math.max(...normalized.map((point) => point.y)) - Math.min(...normalized.map((point) => point.y))),
    },
  };
}

const round = (value) => Math.round(value * 1000) / 1000;

export class RecognitionError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "RecognitionError";
    this.status = status;
  }
}

export const connectorEdits = ["keep", "add_tail", "delete_tail", "delete_arrow", "add_head", "delete_head"];
const editCriteria = {
  add_tail: "Is BLUE a short diagonal ending at the BARE LOWER TAIL endpoint OR a V/chevron wrapped around that endpoint? Either is TRUE; a single side is enough. Allow the black endpoint to lie a little inside the V or meet it with a small gap/overshoot. For an arc use its local tail tangent, NOT the vertical endpoint chord. A single barb can look nearly horizontal or vertical in this upright view and still be TRUE when it joins the bare tip at an angle to the local curved shaft. If TAIL already has a black head, FALSE. A stroke spanning the shaft or multiple zigzags is FALSE: the addition must be localized to the tail. Slashes at an EXISTING head, crossings in the middle, scribbles and closed shapes are FALSE.",
  delete_tail: "Does the BLUE stroke touch or pass through the TIP or a WING of an EXISTING BLACK arrowhead at the LOWER TAIL? A single slash through the head vertex is TRUE even if it does not cross the two wings. This holds at any angle, including a tilted head on a curve. Small scribbles/zigzags at the head also count. If TAIL is bare, FALSE. A barb/V addition at a bare end, closed shapes, and a stroke only in the middle or at the UPPER HEAD are FALSE.",
  delete_arrow: "Does the BLUE stroke cross the middle/interior of the BLACK connector shaft? A single blue line intersecting a black line is TRUE. A tiny blue scribble/zigzag or V crossing the INTERIOR shaft also counts, even with just two short passes. A blue barb/V confined to a real endpoint is FALSE; an interior V is NOT a head addition. Also TRUE for any Z or broader zigzag/scribble touching the shaft OR a bare endpoint: a broad zigzag whose center turn touches a bare endpoint counts even if its other passes run beside the shaft. A local slash/scribble confined to an EXISTING head is FALSE: delete only that head. Ignore blue closed circles/rectangles and unrelated parallel lines. For a curve evaluate its actual curved body, not its chord.",
  add_head: "Is BLUE a short diagonal ending at the BARE UPPER HEAD endpoint OR a V/chevron wrapped around that endpoint? Either is TRUE; a single side is enough. Allow the black endpoint to lie a little inside the V or meet it with a small gap/overshoot. For an arc use its local head tangent, NOT the vertical endpoint chord. A single barb can look nearly horizontal or vertical in this upright view and still be TRUE when it joins the bare tip at an angle to the local curved shaft. If HEAD already has a black head, FALSE. A stroke spanning the shaft or multiple zigzags is FALSE: the addition must be localized to the head. Slashes at an EXISTING head, crossings in the middle, scribbles and closed shapes are FALSE.",
  delete_head: "Does the BLUE stroke touch or pass through the TIP or a WING of an EXISTING BLACK arrowhead at the UPPER HEAD? A single slash through the head vertex is TRUE even if it does not cross the two wings. This holds at any angle, including a tilted head on a curve. Small scribbles/zigzags at the head also count. If HEAD is bare, FALSE. A barb/V addition at a bare end, closed shapes, and a stroke only in the middle or at the LOWER TAIL are FALSE.",
};

export function buildDecisionRequest(sample, imageUrl, connector = null, detailImageUrl) {
  return {
    model: "gpt-6-luna",
    input: imageUrl ? [{ role: "user", content: [
      { type: "input_text", text: connector
        ? `BLACK is the complete existing connector; BLUE is the NEW pen stroke. The image is rotated so its original start/TAIL is the lower endpoint and its original end/HEAD is the upper endpoint. Gray HEAD/TAIL labels are orientation guides, not strokes. TAIL has ${connector.hasStart ? "an existing BLACK arrowhead" : "NO existing arrowhead (bare)"}. HEAD has ${connector.hasEnd ? "an existing BLACK arrowhead" : "NO existing arrowhead (bare)"}. For a curved connector follow the actual curve and endpoint tangents; never straighten it mentally.`
        : "Classify this new pen stroke. Repeated retracing may look like one pass; the geometry measures the complete traveled path." },
      { type: "input_image", image_url: imageUrl, detail: "low" },
      ...(detailImageUrl ? [{ type: "input_text", text: "Second image: zoom around the BLUE gesture, with the SAME orientation as the full overview. This is a crop of the same connector, not another object. Use the overview to identify which endpoint is shown; a cropped shaft endpoint is not a real endpoint." },
        { type: "input_image", image_url: detailImageUrl, detail: "low" }] : []),
      { type: "input_text", text: `New gesture geometry: ${JSON.stringify(sample.geometry)}` },
    ] }] : JSON.stringify({ sample }),
    questions: connector ? connectorEdits.filter((name) => name !== "keep").map((name) => ({
      type: "predicate", name, instructions: editCriteria[name],
    })) : [{
      type: "choice", name: "shape",
      instructions: "Classify this new gesture, or input.sample if no image. Prefer the closest intended shape with ordinary hand-drawing imperfections. Line is mostly straight or has irregular curvature; arc is a clear smooth bow like part of a circle. Rectangle includes squares. Circle includes ovals. Allow small closing gaps and bowed sides. Use none for whole arrows in one stroke, isolated V/barbs, triangles, scribbles or zigzags, including a single Z-shaped mark.",
      choices: labels.map((value) => ({ value, description: criteria[value] })),
    }, ...(imageUrl ? [{
      type: "predicate", name: "scratch_out",
      instructions: "Is the new stroke a scratch-out gesture: a zigzag, overlapping scribble, or repeated back-and-forth passes in the same area? Even a single Z-shaped mark (like Zorro's Z) is TRUE: three connected strokes with two sharp turns are enough, at any rotation or scale. A small zigzag counts without overlapping itself or repeating passes. A single line/curve, isolated V or single angled barb, or a single closed rectangle/circle is FALSE. Use the geometry to identify repeated retracing that the raster image may hide.",
    }] : [])],
  };
}

function isProbability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseDecision(body, expectsConnector = false) {
  const answers = body?.answers;
  if (!Array.isArray(answers)) throw new RecognitionError("OpenAI Decisions returned invalid answers.");
  const contextual = expectsConnector || answers.some((item) => connectorEdits.slice(1).includes(item.name));
  if (contextual) {
    const editProbabilities = {};
    for (const name of connectorEdits.slice(1)) {
      const matching = answers.filter((item) => item.name === name);
      if (matching[0]?.type === "refusal") throw new RecognitionError("OpenAI declined to classify this stroke.", 422);
      if (matching.length !== 1 || matching[0].type !== "predicate" || !isProbability(matching[0].probability)) {
        throw new RecognitionError("OpenAI Decisions returned invalid connector edit probabilities.");
      }
      editProbabilities[name] = matching[0].probability;
    }
    // Addition first prevents an intended barb from being erased. Endpoint
    // deletions take priority over whole-connector deletion. In either group
    // the model's stronger endpoint score wins, with no local endpoint guess.
    const best = (names, threshold) => names.filter((name) => editProbabilities[name] >= threshold)
      .sort((a, b) => editProbabilities[b] - editProbabilities[a])[0];
    const connectorEdit = best(["add_tail", "add_head"], 0.6) ?? best(["delete_tail", "delete_head"], 0.85) ?? best(["delete_arrow"], 0.65) ?? "keep";
    return { connectorEdit, connectorEditProbability: connectorEdit === "keep" ? null : editProbabilities[connectorEdit],
      editProbabilities, label: "none", confidence: null, model: body.model, usage: body.usage };
  }
  const matching = answers.filter((item) => item.name === "shape");
  const answer = matching[0];
  if (answer?.type === "refusal") throw new RecognitionError("OpenAI declined to classify this stroke.", 422);
  if (matching.length !== 1 || answer.type !== "choice" || !labels.includes(answer.choice) || !isProbability(answer.confidence)) {
    throw new RecognitionError("OpenAI Decisions returned an invalid shape answer.");
  }
  const probabilities = answer.probabilities;
  if (!Array.isArray(probabilities) || probabilities.length !== labels.length ||
      new Set(probabilities.map((item) => item.value)).size !== labels.length ||
      probabilities.some((item) => !labels.includes(item.value) || !isProbability(item.probability))) {
    throw new RecognitionError("OpenAI Decisions returned invalid shape probabilities.");
  }
  const scratch = answers.find((item) => item.name === "scratch_out" && item.type === "predicate");
  return { connectorEdit: null, connectorEditProbability: null,
    label: answer.choice, confidence: answer.confidence,
    scratchOutProbability: isProbability(scratch?.probability) ? scratch.probability : null,
    probabilities, model: body.model, usage: body.usage };
}

export async function recognizeStroke(sample, { apiKey, fetchImpl = fetch, timeoutMs = 10_000, imageUrl, detailImageUrl, connector = null }) {
  const request = buildDecisionRequest(sample, imageUrl, connector, detailImageUrl);
  const payload = JSON.stringify(request);
  // Measure only the upstream send/receive, excluding image generation.
  const apiStarted = performance.now();
  let upstream;
  try {
    upstream = await fetchImpl("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new RecognitionError("OpenAI Decisions timed out. Try another stroke.", 504);
    }
    throw new RecognitionError("Could not reach OpenAI Decisions.");
  }
  if (!upstream.ok) {
    const explanations = {
      401: "OpenAI rejected the API key. Check OPENAI_API_KEY in .env and restart.",
      403: "This OpenAI project does not have access to the Decisions API.",
      404: "OpenAI Decisions or gpt-6-luna is unavailable for this project.",
      429: "OpenAI rate limit or quota reached. Check your API project, then retry.",
    };
    throw new RecognitionError(explanations[upstream.status] || `OpenAI Decisions returned HTTP ${upstream.status}.`, upstream.status === 429 ? 429 : 502);
  }
  let body;
  try {
    body = await upstream.json();
  } catch {
    throw new RecognitionError("OpenAI Decisions returned invalid JSON.");
  }
  const apiLatencyMs = Math.round(performance.now() - apiStarted);
  return { ...parseDecision(body, Boolean(connector)), apiLatencyMs, estimatedCostUsd: estimateDecisionCostUsd(body.model, body.usage), debug: request };
}
