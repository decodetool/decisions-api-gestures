import test from "node:test";
import assert from "node:assert/strict";
import { estimateDecisionCostUsd } from "../lib/decision-pricing.mjs";

test("Decisions estimates input-only cost without extra cache or output charges", () => {
  assert.equal(estimateDecisionCostUsd("gpt-6-luna", {
    input_tokens: 1_000, input_tokens_details: { cached_tokens: 500, cache_write_tokens: 200 },
    output_tokens: 900, total_tokens: 1_900,
  }), 0.0001);
  assert.equal(estimateDecisionCostUsd("gpt-6-luna", { input_tokens: 1 }), 0.0000001);
  assert.equal(estimateDecisionCostUsd("gpt-6-luna", { input_tokens: 0 }), 0);
});

test("Luna's long-context rate applies only above 272K input tokens", () => {
  assert.equal(estimateDecisionCostUsd("gpt-6-luna", { input_tokens: 272_000 }), 0.0272);
  assert.equal(estimateDecisionCostUsd("gpt-6-luna", { input_tokens: 272_001 }), 0.0544002);
});

test("unknown models and missing or invalid usage show unavailable cost, never a fabricated zero", () => {
  assert.equal(estimateDecisionCostUsd("unknown", { input_tokens: 100 }), null);
  for (const usage of [undefined, {}, { input_tokens: null }, { input_tokens: "100" }, { input_tokens: -1 }, { input_tokens: 1.5 }, { input_tokens: Infinity }]) {
    assert.equal(estimateDecisionCostUsd("gpt-6-luna", usage), null);
  }
});
