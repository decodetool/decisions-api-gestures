# Recognition details

All source paths below are relative to the repository root.

## Decisions recognition and editing

`lib/decisions.mjs` sends `POST https://api.openai.com/v1/decisions` using `gpt-6-luna`. Stroke-only requests include a normalized 256 × 256 image and complete-stroke geometry. They ask for a shape choice (line, arc, rectangle, circle, none) and an independent scratch-out predicate. Ordinary shape recognition requires confidence of at least 0.6; scratch intent requires probability of at least 0.85. Circle snapping remains local and adds no choices or prompt rules.

Bounding-box overlap triggers a contextual connector request. The complete visible connector (black) and new gesture (blue) rotate together so the original start/tail is at the bottom and original end/head at the top, even for lines or two-headed arrows. Actual arc geometry is retained. A second, identically oriented view zooms around the gesture so small scratches and barbs remain readable. Both images go into the same Decisions call; the crop chooses no endpoint.

Decisions returns five independent predicates: `add_tail`, `delete_tail`, `delete_arrow`, `add_head`, `delete_head`. The model receives explicit flags for existing heads and decides contact, intent and endpoint. The app uses no nearest-end inference, head-radius deletion test, or standalone-scribble fallback for connector edits. Acceptance thresholds are 0.60 for additions, 0.65 for whole-connector erasure and 0.85 for head-only erasure, calibrated on procedural live checks.

Accepted additions take priority over erasing, then head-only deletions take priority over whole-connector deletions. The stronger model score selects the endpoint within each group. Impossible state changes are rejected without substituting the other endpoint. Head edits preserve bindings and the objects beneath them. Standalone scratch detection still erases every covered non-connector shape; each connector requires its own contextual deletion decision. All checks run concurrently, strokes are queued in drawing order, and stale targets cannot be overwritten.

## Arc geometry and connections

A circular arc uses tldraw's native `bend`. The signed distance of each point from the first-to-last chord determines curvature. A travel-weighted signed average chooses the dominant side, then the largest distance on that side supplies the bend. This handles either bow direction, reversed strokes and rotation without guessing new endpoints. One or more endpoint bindings are required to retain the bend; otherwise the result is a straight line.

Connections use one geometry lookup per tip, with interior hits and a one-screen-pixel rounding allowance. Each endpoint binds precisely to the topmost eligible shape there; shapes beneath the middle are ignored. Subsequent head edits preserve bindings. Recognition and erase checks render the current visible circular arc and orient heads along its endpoint tangents, including after attached shapes move.

Scratch targets are sampled along the actual pen path using every hit layer. All targets are validated before the batch begins, so deleting a node and thereby changing a connected arrow cannot cause that arrow's deletion to be skipped. Head-only edits exclude the underlying shapes. Feedback animations stay outside history.


## Live checks

The scripts in `scripts/check-*.mjs` send procedural gestures to the local server on port 5178. They use the server’s API key and make billable requests. Start `npm run dev` before running them. The development-only `/tests/canvas-test.html` harness exercises the canvas watcher with live requests as well.
