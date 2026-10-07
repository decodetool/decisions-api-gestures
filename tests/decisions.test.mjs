import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../lib/api.mjs";
import { labels, compactStroke, buildDecisionRequest, parseDecision, recognizeStroke } from "../lib/decisions.mjs";
import { renderStrokeImage } from "../lib/stroke-image.mjs";
import sharp from "sharp";
import { cases } from "../scripts/check-shapes.mjs";

const points = Array.from({ length: 30 }, (_, x) => ({ x: x * 5, y: x * 2 }));
const answer = () => ({
  model: "gpt-6-luna",
  answers: [{
    name: "shape", type: "choice", choice: "line", confidence: 0.93,
    probabilities: labels.map((value) => ({ value, probability: value === "line" ? 0.95 : 0.01 })),
  }],
  usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 },
});

test("preserves scale/translation-invariant preprocessing and supplies line/arc and the non-arrow shape choices", () => {
  const sample = compactStroke(points);
  const moved = compactStroke(points.map(({ x, y }) => ({ x: x * 3 + 500, y: y * 3 - 800 })));
  assert.deepEqual(sample, moved);
  assert.equal(sample.points.length, 24);
  assert.equal(sample.geometry.sharpTurnCount, 0);
  const request = buildDecisionRequest(sample);
  assert.equal(request.model, "gpt-6-luna");
  assert.deepEqual(JSON.parse(request.input), { sample });
  assert.equal(request.questions[0].type, "choice");
  assert.deepEqual(request.questions[0].choices.map((item) => item.value), labels);
  assert.ok(request.questions[0].choices.every((item) => item.description));
  assert.equal("state" in request, false);
  assert.throws(() => compactStroke([{ x: 1, y: 1 }]), /longer stroke/);
});

test("maps Decisions choice/confidence and refuses malformed or declined answers", () => {
  const body = answer();
  const result = parseDecision(body);
  assert.equal(result.label, "line");
  assert.equal(result.confidence, 0.93);
  assert.deepEqual(result.probabilities, body.answers[0].probabilities);
  assert.throws(() => parseDecision({ answers: [{ name: "shape", type: "refusal" }] }), /declined/);
  assert.throws(() => parseDecision({ answers: [] }), /invalid shape answer/);
  for (const bad of [-1, 2, null, "0.9", NaN]) {
    const body = answer();
    body.answers[0].confidence = bad;
    assert.throws(() => parseDecision(body), /invalid shape answer/);
  }
  const duplicate = answer();
  duplicate.answers[0].probabilities[1].value = "line";
  assert.throws(() => parseDecision(duplicate), /invalid shape probabilities/);
});

test("standalone requests never classify whole arrows or ask for automatic barb detection", () => {
  const request = buildDecisionRequest(compactStroke(points), "data:image/png;base64,test");
  assert.deepEqual(request.questions[0].choices.map((c) => c.value), ["line", "arc", "rectangle", "circle", "none"]);
  assert.deepEqual(request.questions.map((q) => q.name), ["shape", "scratch_out"]);
  const body = answer();
  body.answers.push({ name: "one_barb", type: "predicate", probability: 1 });
  assert.equal(parseDecision(body).label, "line");
});

test("scratch intent is returned independently of the shape classification", () => {
  const body = answer();
  body.answers.push({ name: "scratch_out", type: "predicate", probability: 0.97 });
  const result = parseDecision(body);
  assert.equal(result.label, "line");
  assert.equal(result.confidence, 0.93);
  assert.equal(result.scratchOutProbability, 0.97);
});

test("image evidence retains a complete dense rectangle and produces a normalized inline PNG", async () => {
  const sparse = cases.find((item) => item.name === "rectangle").points;
  const dense = cases.find((item) => item.name === "dense rectangle").points;
  // Deduplication may omit a sub-pixel final step, but must retain the
  // fourth side rather than truncating the original long stroke.
  assert.ok(compactStroke(dense).geometry.startEndGap < 0.01);
  const imageUrl = await renderStrokeImage(dense);
  const metadata = await sharp(Buffer.from(imageUrl.split(",")[1], "base64")).metadata();
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  const shifted = sparse.map(({ x, y }) => ({ x: x * 3 + 400, y: y * 3 - 200 }));
  assert.equal(await renderStrokeImage(sparse), await renderStrokeImage(shifted));
  const request = buildDecisionRequest(compactStroke(dense), imageUrl);
  assert.equal(request.input[0].role, "user");
  assert.equal(request.input[0].content[1].image_url, imageUrl);
  assert.equal(request.input[0].content[1].detail, "low");
});

test("calls the dedicated endpoint with server credentials and never returns the key", async () => {
  const result = await recognizeStroke(compactStroke(points), {
    apiKey: "test-secret",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/decisions");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      assert.equal(JSON.parse(options.body).questions[0].name, "shape");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(answer());
    },
  });
  assert.equal(result.label, "line");
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
});

test("handles quota, invalid JSON and network timeouts without forwarding upstream secrets", async () => {
  await assert.rejects(recognizeStroke({}, {
    apiKey: "test-secret", fetchImpl: async () => new Response("test-secret", { status: 429 }),
  }), (error) => error.status === 429 && !error.message.includes("test-secret"));
  await assert.rejects(recognizeStroke({}, {
    apiKey: "test-secret", fetchImpl: async () => new Response("not json"),
  }), /invalid JSON/);
  await assert.rejects(recognizeStroke({}, {
    apiKey: "test-secret", fetchImpl: async () => { throw new DOMException("test-secret", "TimeoutError"); },
  }), (error) => error.status === 504 && !error.message.includes("test-secret"));
});

async function serve(t, options) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("HTTP API reports missing configuration without making a billable call", async (t) => {
  let calls = 0;
  const base = await serve(t, { getApiKey: () => "", fetchImpl: () => { calls++; throw new Error("Unexpected upstream call"); } });
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ready, false);
  const result = await fetch(`${base}/api/recognize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points }) });
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /OPENAI_API_KEY/);
  assert.equal(calls, 0);
});

test("HTTP API retains browser contract, measures latency and rejects bad strokes/payloads", async (t) => {
  let calls = 0;
  const base = await serve(t, { getApiKey: () => "test-secret", fetchImpl: async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.match(request.input[0].content[1].image_url, /^data:image\/png;base64,/);
    return Response.json(answer());
  } });
  const post = (body) => fetch(`${base}/api/recognize`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const success = await post(JSON.stringify({ points }));
  assert.equal(success.status, 200);
  const result = await success.json();
  assert.equal(result.label, "line");
  assert.equal(result.confidence, 0.93);
  assert.ok(result.latencyMs >= 0);
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
  assert.equal((await post(JSON.stringify({ points: [] }))).status, 422);
  assert.equal((await post("{")).status, 400);
  assert.equal((await post(JSON.stringify({ points, contextStrokes: ["invalid"] }))).status, 422);
  assert.equal((await post(JSON.stringify({ points, contextStrokes: [[{ x: NaN, y: 0 }, { x: 200, y: 0 }]] }))).status, 422);
  assert.equal(calls, 1);
});

test("overlap requests include a combined connector image and independent contextual edit predicates", async (t) => {
  const base = await serve(t, { getApiKey: () => "test-secret", fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    const images = request.input[0].content.filter((part) => part.type === "input_image");
    assert.equal(images.length, 1);
    assert.deepEqual(request.questions.map((question) => question.name), ["shaft_crossing", "head_crossing", "head_addition"]);
    const body = { answers: [{ name: "head_addition", type: "predicate", probability: 0.98 }, { name: "shaft_crossing", type: "predicate", probability: 0 }, { name: "head_crossing", type: "predicate", probability: 0 }] };
    return Response.json(body);
  } });
  const response = await fetch(`${base}/api/recognize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    points,
    contextStrokes: [[{ x: 0, y: 0 }, { x: 200, y: 0 }], [{ x: 170, y: -20 }, { x: 200, y: 0 }, { x: 170, y: 20 }]],
  }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.headAdditionProbability, 0.98);
  assert.equal(result.shaftCrossingProbability, 0);
});

test("malformed contextual predicates cannot become deletion operations", () => {
  for (const edit of [
    { name: "shaft_crossing", type: "predicate", probability: 2 },
    { name: "shaft_crossing", type: "refusal" },
    { name: "head_addition", type: "predicate", probability: 0.99 },
  ]) assert.throws(() => parseDecision({ answers: [edit] }), /invalid connector edit/);
  assert.equal(parseDecision(answer()).shaftCrossingProbability, null);
});

test("tiny two-sample flicks are valid API evidence without requiring repeated passes", async () => {
  const tiny = [{ x: 0, y: 0 }, { x: 4, y: 4 }];
  assert.equal(compactStroke(tiny).points.length, 24);
  assert.match(await renderStrokeImage(tiny), /^data:image\/png;base64,/);
});
