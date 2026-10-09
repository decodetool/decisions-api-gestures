import express from "express";
import { performance } from "node:perf_hooks";
import { compactStroke, recognizeStroke, RecognitionError } from "./decisions.mjs";
import { renderStrokeImage } from "./stroke-image.mjs";

export function createApp({ getApiKey = () => process.env.OPENAI_API_KEY, fetchImpl = fetch } = {}) {
  const app = express();
  app.use(express.json({ limit: "300kb" }));
  app.get("/api/health", (_request, response) => {
    response.json({ ready: Boolean(getApiKey()?.trim()), provider: "openai-decisions", model: "gpt-6-luna" });
  });
  app.post("/api/recognize", async (request, response) => {
    const apiKey = getApiKey()?.trim();
    if (!apiKey) return response.status(503).json({ error: "Add OPENAI_API_KEY to this project's .env, then restart the server." });
    let sample;
    let contextStrokes = [];
    let connector = null;
    try {
      sample = compactStroke(Array.isArray(request.body?.points) ? request.body.points : []);
      if (request.body.contextStrokes !== undefined) {
        const context = request.body.contextStrokes;
        if (!Array.isArray(context) || context.length > 3 || context.some((path) =>
          !Array.isArray(path) || path.length < 2 || path.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))) {
          throw new Error("Invalid arrow context.");
        }
        contextStrokes = context;
        if (context.length) {
          const flags = request.body.contextConnector;
          if (!flags || typeof flags.hasStart !== "boolean" || typeof flags.hasEnd !== "boolean" ||
              context.length !== 1 + Number(flags.hasStart) + Number(flags.hasEnd)) throw new Error("Invalid connector head flags.");
          const start = context[0][0], end = context[0].at(-1);
          if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) throw new Error("Invalid connector endpoints.");
          connector = { hasStart: flags.hasStart, hasEnd: flags.hasEnd };
        }
      }
    } catch (error) {
      return response.status(422).json({ error: error.message });
    }
    const started = performance.now();
    try {
      const imageUrl = await renderStrokeImage(request.body.points, contextStrokes);
      const detailImageUrl = connector ? await renderStrokeImage(request.body.points, contextStrokes, { focusGesture: true }) : undefined;
      const result = await recognizeStroke(sample, { apiKey, fetchImpl, imageUrl, detailImageUrl, connector });
      response.json({ ...result, latencyMs: Math.round(performance.now() - started) });
    } catch (error) {
      const status = error instanceof RecognitionError ? error.status : 502;
      // Never forward an upstream body or log credentials / input strokes.
      response.status(status).json({ error: error instanceof RecognitionError ? error.message : "Could not reach OpenAI Decisions." });
    }
  });
  app.use("/api", (_request, response) => response.status(404).json({ error: "Unknown API route." }));
  app.use((error, _request, response, next) => {
    if (!error) return next();
    response.status(error.status === 413 ? 413 : 400).json({ error: error.status === 413 ? "Stroke payload is too large." : "Invalid JSON payload." });
  });
  return app;
}
