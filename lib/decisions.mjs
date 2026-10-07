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

export function buildDecisionRequest(sample, imageUrl, hasContext = false, contextHeadCount = 0) {
  const arrowQuestions = [
    { type: "predicate", name: "shaft_crossing", instructions: "Does the BLUE stroke cross the middle/interior of the BLACK connector shaft? A single blue line intersecting a black line is TRUE. A tiny blue scribble/zigzag crossing the shaft also counts. A blue barb at an endpoint is FALSE. Ignore any blue closed circle or rectangle. For a curve evaluate its actual curved body." },
    { type: "predicate", name: "head_crossing", instructions: "Does the BLUE stroke touch or pass through the TIP or a WING of an EXISTING BLACK arrowhead? A single slash through the head vertex is TRUE even if it does not cross the two wings. This holds at any angle, including a tilted head on a curve. A stroke in the middle of the shaft away from its heads is FALSE. If this view has zero existing heads, FALSE. A blue barb at a bare endpoint, or a new closed circle/rectangle, is FALSE." },
    { type: "predicate", name: "head_addition", instructions: "Does a BLUE diagonal meet a BARE endpoint of BLACK, forming an acute-angle corner? This is a one-sided arrowhead (barb). Either endpoint and either side count, with a small gap allowed. A blue V with its vertex at the endpoint also counts. Crossing the middle of BLACK, slashing an EXISTING black head, or drawing a closed shape is FALSE. For an arc evaluate the corner against its local endpoint tangent." },
  ];
  return {
    model: "gpt-6-luna",
    input: imageUrl ? [{ role: "user", content: [
      { type: "input_text", text: hasContext
        ? `BLACK is the existing connector. There are ${contextHeadCount} EXISTING black arrowheads in this view, represented by angled V wings. BLUE is the NEW pen stroke.`
        : "Classify this new pen stroke. Repeated retracing may look like one pass; the geometry measures the complete traveled path." },
      { type: "input_image", image_url: imageUrl, detail: "low" },
      ...(!hasContext ? [{ type: "input_text", text: `New gesture geometry: ${JSON.stringify(sample.geometry)}` }] : []),
    ] }] : JSON.stringify({ sample }),
    questions: hasContext ? arrowQuestions : [{
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

export function parseDecision(body) {
  const answers = body?.answers;
  const answer = answers?.find((item) => item.name === "shape");
  const contextual = answers?.some((item) => ["head_addition", "head_crossing", "shaft_crossing"].includes(item.name));
  if (answer?.type === "refusal") throw new RecognitionError("OpenAI declined to classify this stroke.", 422);
  if ((!answer && !contextual) || (answer && (answer.type !== "choice" || !labels.includes(answer.choice) || !isProbability(answer.confidence)))) {
    throw new RecognitionError("OpenAI Decisions returned an invalid shape answer.");
  }
  const probabilities = answer?.probabilities;
  if (answer && (!Array.isArray(probabilities) || probabilities.length !== labels.length ||
      new Set(probabilities.map((item) => item.value)).size !== labels.length ||
      probabilities.some((item) => !labels.includes(item.value) || !isProbability(item.probability)))) {
    throw new RecognitionError("OpenAI Decisions returned invalid shape probabilities.");
  }
  const probabilityFor = (name) => {
    const item = answers.find((item) => item.name === name && item.type === "predicate");
    return isProbability(item?.probability) ? item.probability : null;
  };
  const headAdditionProbability = probabilityFor("head_addition"), headCrossingProbability = probabilityFor("head_crossing"), shaftCrossingProbability = probabilityFor("shaft_crossing");
  if (contextual && [headAdditionProbability, headCrossingProbability, shaftCrossingProbability].some((p) => p === null)) {
    throw new RecognitionError("OpenAI Decisions returned invalid connector edit probabilities.");
  }
  return {
    headAdditionProbability, headCrossingProbability, shaftCrossingProbability,
    label: answer?.choice ?? "none", confidence: answer?.confidence ?? 0,
    scratchOutProbability: probabilityFor("scratch_out"),
    probabilities, model: body.model, usage: body.usage,
  };
}

export async function recognizeStroke(sample, { apiKey, fetchImpl = fetch, timeoutMs = 10_000, imageUrl, hasContext = false, contextHeadCount = 0 }) {
  const request = buildDecisionRequest(sample, imageUrl, hasContext, contextHeadCount);
  let upstream;
  try {
    upstream = await fetchImpl("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
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
  return { ...parseDecision(body), debug: request };
}
