import express from "express";
import { fileURLToPath } from "node:url";
import { createApp } from "./lib/api.mjs";

const app = createApp();
const projectPath = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5178);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");

let vite;
if (process.argv.includes("--production")) {
  app.use(express.static(`${projectPath}dist`, { dotfiles: "deny" }));
  app.get("/{*path}", (_request, response) => response.sendFile(`${projectPath}dist/index.html`));
} else {
  const { createServer } = await import("vite");
  vite = await createServer({ root: projectPath, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

const server = app.listen(port, "127.0.0.1", async (error) => {
  if (error) {
    console.error(error.code === "EADDRINUSE" ? `Port ${port} is in use. Set another PORT in .env.` : "Could not start the local server.");
    await vite?.close();
    process.exit(1);
  }
  console.log(`Magic Pen — OpenAI Decisions is ready on http://127.0.0.1:${port}`);
  if (!process.env.OPENAI_API_KEY?.trim()) console.log("Add OPENAI_API_KEY to .env, then restart to enable recognition.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await vite?.close();
    server.close(() => process.exit(0));
  });
}
