# Magic Pen — OpenAI Decisions × tldraw

The same magic-pen prototype as `../2026-09-20-magic-pen-tldraw`, with Jev replaced by OpenAI's Decisions API. The referenced `../2026-09-20-jev-stroke-recognition` folder currently contains only benchmark results; the companion magic-pen project supplies the canvas implementation.

## Setup

Requires Node 22.9+ (Node 24 recommended).

Add your API key to the `.env` file in this project:

```dotenv
OPENAI_API_KEY=your-key-here
PORT=5178
```

`.env` is gitignored. Only the server reads the key; do not prefix it with `VITE_`. For a fresh checkout, copy `.env.example` to `.env` first. The key must belong to an OpenAI API project with billing/quota and access to `gpt-6-luna` / Decisions. Restart after editing `.env`.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5178. The UI and recognition API share one local server.

## Interaction

- Magic Pen occupies tldraw's native pencil slot, starts active, and uses `B` or `M`.
- Draw a line, arc, rectangle/square or circle/oval. Connectors preserve the actual first and last stroke points. Lines are straight; a recognized arc stays curved only when at least one endpoint connects to a shape. Unbound arcs become lines.
- Rectangles stay aligned with the canvas. Near-round ovals become exact circles locally when their longer dimension is at most 25% greater than their shorter dimension; their center and average diameter are preserved.
- Connected lines and arcs automatically get an arrowhead at the stroke's release end, even when only one endpoint binds. Unconnected lines stay headless. Draw a short one-sided barb or full V at a bare endpoint to add a head, including a second head for a double arrow. This works on straight and curved connectors. Single-stroke arrow recognition remains disabled.
- Each endpoint connects to just the topmost eligible shape directly underneath it. Moving that shape moves the connector.
- A single line or small scribble crossing a shaft erases that connector when confirmed by Decisions. A stroke over an existing head removes only that head.
- A scratch-out scribble, including a single Z-shaped zigzag, erases every shape/connector beneath its actual path, including overlapping layers. A visible arrowhead under a local scribble takes priority: only the head is removed, preserving the objects beneath it. Locked and hidden shapes are excluded.
- Shapes use solid light-blue fills. Connectors and pen strokes are dark blue. Unmatched strokes flash yellow; scratch/delete gestures flash red, then fade. Undo restores an entire deletion batch or a removed head in one step.
- Gesture strokes fade over 75 ms for every outcome, with no extra hold or tuning controls. The bottom-right table shows the last three Decisions calls, newest first: API ms measures the server-to-OpenAI send/receive only (through response-body receipt, excluding image generation); UX ms measures pointer release to the applied canvas result, including polling, queued strokes, preprocessing and both network trips, but excluding the fade. Parallel checks for one gesture share its UX time. Est. USD shows the estimated price of each individual call, including separate parallel checks, with seven decimal places. A dash means timing or price is unavailable.

The API returns token usage, not a billed dollar amount. The estimate uses the returned `usage.input_tokens` and Decisions-specific standard pricing verified on 2026-10-07: $0.10 per million input tokens, with no extra cache or output charges. Requests above 272K input tokens use the 2× input rate. The prototype uses the global endpoint; estimates exclude regional premiums and account-specific discounts. Unknown models or missing/invalid usage display a dash. See the [Decisions pricing guide](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability) and [Luna long-context pricing](https://developers.openai.com/api/docs/models/gpt-6-luna).

## Decisions recognition and editing

`lib/decisions.mjs` sends `POST https://api.openai.com/v1/decisions` using `gpt-6-luna`. Stroke-only requests include a normalized 256 × 256 image and complete-stroke geometry. They ask for a shape choice (line, arc, rectangle, circle, none) and an independent scratch-out predicate. Ordinary shape recognition requires confidence of at least 0.6; scratch intent requires probability of at least 0.85. Circle snapping remains local and adds no choices or prompt rules.

Bounding-box overlap triggers a contextual connector request. The complete visible connector (black) and new gesture (blue) rotate together so the original start/tail is at the bottom and original end/head at the top, even for lines or two-headed arrows. Actual arc geometry is retained. A second, identically oriented view zooms around the gesture so small scratches and barbs remain readable. Both images go into the same Decisions call; the crop chooses no endpoint.

Decisions returns five independent predicates: `add_tail`, `delete_tail`, `delete_arrow`, `add_head`, `delete_head`. The model receives explicit flags for existing heads and decides contact, intent and endpoint. The app uses no nearest-end inference, head-radius deletion test, or standalone-scribble fallback for connector edits. Acceptance thresholds are 0.60 for additions, 0.65 for whole-connector erasure and 0.85 for head-only erasure, calibrated on procedural live checks.

Accepted additions take priority over erasing, then head-only deletions take priority over whole-connector deletions. The stronger model score selects the endpoint within each group. Impossible state changes are rejected without substituting the other endpoint. Head edits preserve bindings and the objects beneath them. Standalone scratch detection still erases every covered non-connector shape; each connector requires its own contextual deletion decision. All checks run concurrently, strokes are queued in drawing order, and stale targets cannot be overwritten.

## Arc geometry and connections

A circular arc uses tldraw's native `bend`. The signed distance of each point from the first-to-last chord determines curvature. A travel-weighted signed average chooses the dominant side, then the largest distance on that side supplies the bend. This handles either bow direction, reversed strokes and rotation without guessing new endpoints. One or more endpoint bindings are required to retain the bend; otherwise the result is a straight line.

Connections use one geometry lookup per tip, with interior hits and a one-screen-pixel rounding allowance. Each endpoint binds precisely to the topmost eligible shape there; shapes beneath the middle are ignored. Subsequent head edits preserve bindings. Recognition and erase checks render the current visible circular arc and orient heads along its endpoint tangents, including after attached shapes move.

Scratch targets are sampled along the actual pen path using every hit layer. All targets are validated before the batch begins, so deleting a node and thereby changing a connected arrow cannot cause that arrow's deletion to be skipped. Head-only edits exclude the underlying shapes. Feedback animations stay outside history.

## Validation

```sh
npm test
npm run build
```

Tests cover complete dense-stroke rendering and use a mocked OpenAI endpoint to verify the request/response adapter and server failures without using a key or incurring charges. A successful build and mocked tests do not establish live model accuracy or speed. The existing Jev benchmark files contain outcomes, not original point samples, so they cannot be rerun as an identical dataset here.

The development-only `/tests/canvas-test.html` harness runs synthetic connected lines, head edits, and scratch-out gestures through the actual canvas watcher and live Decisions API. Its buttons make billable requests; it is not included in the production UI.

To serve the built UI and API after `npm run build`:

```sh
npm start
```

Run `node --experimental-strip-types scripts/check-connector-edits.mjs` for 13 live checks covering head/tail selection across rotations, arc-body versus chord crossings and arc-end barbs (13 billable requests).

Run `node --experimental-strip-types scripts/check-arrows.mjs` for nine live checks of separate head strokes, upward/downward tail heads with small edge overlaps, and an isolated V (nine billable requests). `node --experimental-strip-types scripts/check-edits.mjs` checks shaft/head deletion and unrelated strokes (seven billable requests).

For a small live check of rectangles, squares, curved connectors, disabled single-stroke arrows and fallback shapes, run `node scripts/check-shapes.mjs` with the dev server running. This makes 13 billable API requests using the server’s key. These procedural samples do not establish accuracy on human drawings.

## Sources

- [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
- [OpenAI Decisions API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
- [TypeSafe / Jev introduction](https://docs.typesafe.ai/introduction)

The shared confidence threshold is kept for prototype parity, but confidence from different models is not necessarily calibrated the same way. Evaluate real drawings before treating this as production recognition.

## Private Vercel deployment

Live URL: https://openai-decisions-magic-pen.vercel.app/

The Vercel project `francoislaberges-projects/openai-decisions-magic-pen` has Vercel Authentication enabled for **all deployments**, including the stable domain. Sign in with the Vercel account that owns the project. Unauthenticated requests to both the canvas and `/api` redirect to login. Do not disable protection or distribute automation bypass credentials.

`vercel.json` builds the frontend with `npm run build:private`: `NODE_ENV=development vite build --mode development`. This is an actual development frontend bundle, even when Vercel labels the deployment “Production.” The normal `npm run build` command still produces a production frontend. The deployed API remains a Node function: `api/index.js` exports the existing Express app, and `/api/:path*` rewrites to that function. It does not start the local Vite server.

`OPENAI_API_KEY` is stored as a Vercel **Secret** for Preview and Production, read only by the server-side API. `.env`, `.env.*`, local Vercel state, and results are excluded from uploads / Git as appropriate. Never use a `VITE_` prefix for the OpenAI key. Changes to cloud environment variables require a new deployment.

From this experiment directory, future deployments can use:

```sh
npx --yes vercel@latest deploy --prod --yes --scope francoislaberges-projects
```

For an authenticated health check using the CLI:

```sh
npx --yes vercel@latest curl /api/health --deployment https://openai-decisions-magic-pen.vercel.app --scope francoislaberges-projects
```

Vercel's CLI uses a private automation bypass for this request; the public deployment continues to require login. Keep `.vercel/` ignored because it can hold local project / automation credentials.
