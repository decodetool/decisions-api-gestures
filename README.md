# Decisions API Gestures

Draw shapes, connectors, arrowheads, and scratch-out gestures on a tldraw canvas. OpenAI’s Decisions API recognizes the strokes; the canvas converts them into editable shapes.

## Run locally

You need **Node.js 24+** and an **OpenAI API key** with billing/quota and access to the Decisions API (`gpt-6-luna`).

1. Clone and install:

```sh
git clone https://github.com/decodetool/decisions-api-gestures.git
cd decisions-api-gestures
npm ci
cp .env.example .env
```

2. Open `.env` and add your own key:

```dotenv
OPENAI_API_KEY=your-key-here
PORT=5178
```

3. Start the app:

```sh
npm run dev
```

4. Open **http://127.0.0.1:5178/** and draw.

The key stays on the Node server. `.env` is ignored by Git. Restart the server after changing it. Recognition calls use your OpenAI credits; one gesture can make several parallel calls when it overlaps existing connectors.

If port 5178 is busy, change `PORT` in `.env`, restart, and open that port instead.

## Try it

- The **Magic Pen** starts selected. Press **B** or **M** to return to it.
- Draw rectangles/squares, circles/ovals, or lines. Near-round ovals snap to circles.
- Draw a line or curved arc starting or ending on a shape to connect it. The release end gets an arrowhead.
- Add an arrowhead in a separate stroke: draw a V or a single barb at a bare endpoint. Add one at the other end for a two-headed arrow.
- Scribble over shapes to erase them. A slash across a connector can erase it; a mark over an existing arrowhead removes just that head.
- Use **Undo** to restore a change. Shapes are light blue; connectors and ink are dark blue. Yellow feedback means no accepted match; red means an erase gesture.

The bottom-right table shows the last three API calls: **API ms**, **UX ms** (stroke release to result), and **estimated USD**. The price is calculated from returned usage, not an invoice.

## Check setup

With the server running:

```sh
curl http://127.0.0.1:5178/api/health
```

`"ready": true` means a key is configured. It does not verify upstream access. If recognition fails, inspect `/api/recognize` in the browser’s Network panel: check the key for 401/403 errors and billing/quota for 429 errors. Restart after editing `.env`.

## Tests and builds

```sh
npm test
npm run build
```

The tests use a mocked OpenAI endpoint and do not spend API credits. To serve the built app locally, run `npm start`.

## Deploy your own copy

The included `vercel.json` deploys a Vite frontend and a server-side `/api/recognize` function.

1. Fork this repo and import your fork as a Vercel project. Use the repository root as the Root Directory.
2. Set **Deployment Protection → Vercel Authentication → All Deployments** for private access.
3. Add **`OPENAI_API_KEY`** as a **Secret / Sensitive** environment variable for Production and Preview. Use your own key. The local `.env` is not uploaded.
4. Deploy. Redeploy after changing environment variables.

The provided configuration builds the frontend with `npm run build:private` (development mode) for private testing. `npm run build` produces a normal production frontend; tldraw’s production setup is described in its [license-key documentation](https://tldraw.dev/sdk-features/license-key). Keep the OpenAI key server-side under `OPENAI_API_KEY`, without a `VITE_` prefix.

The maintainer’s **[hosted demo](https://openai-decisions-magic-pen.vercel.app/)** requires access to the maintainer’s Vercel project. Your clone runs locally using your own key. Existing-project CLI deployment steps are in [docs/maintainer-deployment.md](docs/maintainer-deployment.md).

## How it works

The browser sends stroke points to the local/server-side API. The server renders image evidence, calls OpenAI Decisions, and returns shape or connector-edit probabilities. Overlapping connector checks run in parallel. See [recognition details](docs/recognition.md) and the [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions).
