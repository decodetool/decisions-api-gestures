// Decisions-specific standard pricing, verified 2026-10-07:
// https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability
// Input only; cache details and output tokens incur no additional charges.
// This prototype uses api.openai.com without regional processing premiums.
export function estimateDecisionCostUsd(model, usage) {
  const tokens = usage?.input_tokens;
  if (model !== "gpt-6-luna" || !Number.isSafeInteger(tokens) || tokens < 0) return null;
  // Luna's long-context multiplier applies to the full request above 272K.
  const multiplier = tokens > 272_000 ? 2 : 1;
  return tokens * multiplier / 10_000_000;
}
