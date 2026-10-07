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

## Decisions recognition and editing

`lib/decisions.mjs` sends `POST https://api.openai.com/v1/decisions` using `gpt-6-luna`. Stroke-only requests include a normalized 256 × 256 image and complete-stroke geometry. They ask for a shape choice (line, arc, rectangle, circle, none) and an independent scratch-out predicate. Ordinary shape recognition requires confidence of at least 0.6; scratch intent requires probability of at least 0.85. Circle snapping remains local and adds no choices or prompt rules.

When the stroke's bounds overlap a straight or curved connector's bounds, a parallel contextual request shows a **single combined image**: the existing shaft and heads in black, and the new stroke in blue. Small edits near one endpoint use a focused view of the shaft and any head there, making short barbs and slashes readable on long or angled arcs. Three Decisions predicates check head addition, existing-head crossing and shaft crossing. Keeping this context in one image avoids confusing different views or dividing confidence between start/end choices. Head addition uses probability 0.65; deletion uses 0.85. Local geometry chooses the touched endpoint/objects and verifies contact, but never decides scratch or deletion intent on its own. There is no repeated-pass deletion heuristic.

An accepted head addition takes priority over erasing. Heads are added only at a bare tip; existing heads are removed only at the contacted head. Shape classification and each overlapping connector check run concurrently. Strokes are queued in drawing order so a quickly drawn second head sees the newly recognized shaft. Moved, edited, deleted or off-page targets cannot be overwritten by stale answers.

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

Run `node --experimental-strip-types scripts/check-arrows.mjs` for five live checks of separate head strokes and an isolated V (five billable requests). `node --experimental-strip-types scripts/check-edits.mjs` checks shaft/head deletion and unrelated strokes (seven billable requests).

For a small live check of rectangles, squares, curved connectors, disabled single-stroke arrows and fallback shapes, run `node scripts/check-shapes.mjs` with the dev server running. This makes 13 billable API requests using the server’s key. These procedural samples do not establish accuracy on human drawings.

## Sources

- [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
- [OpenAI Decisions API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
- [TypeSafe / Jev introduction](https://docs.typesafe.ai/introduction)

The shared confidence threshold is kept for prototype parity, but confidence from different models is not necessarily calibrated the same way. Evaluate real drawings before treating this as production recognition.
