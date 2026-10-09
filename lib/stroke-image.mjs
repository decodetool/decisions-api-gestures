import sharp from "sharp";

// Rotate every path together, preserving handedness and the actual arc. The
// stored start is always TAIL/bottom; the stored end is always HEAD/top,
// regardless of which endpoints currently have an arrowhead.
export function orientConnectorPaths(paths) {
  const start = paths[0][0], end = paths[0].at(-1);
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) throw new Error("Invalid connector endpoints.");
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return paths.map((path) => path.map((p) => ({
    x: ((p.x - center.x) * -dy + (p.y - center.y) * dx) / length,
    y: ((p.x - center.x) * -dx + (p.y - center.y) * -dy) / length,
  })));
}

export async function renderStrokeImage(rawPoints, contextStrokes = [], { focusGesture = false } = {}) {
  const valid = (points) => points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  const rawPaths = [...contextStrokes.map(valid), valid(rawPoints)];
  const paths = contextStrokes.length ? orientConnectorPaths(rawPaths) : rawPaths;
  const points = paths.flat();
  if (points.length < 2) throw new Error("Draw a longer stroke.");
  let minX = Math.min(...points.map((point) => point.x));
  let minY = Math.min(...points.map((point) => point.y));
  let width = Math.max(...points.map((point) => point.x)) - minX;
  let height = Math.max(...points.map((point) => point.y)) - minY;
  if (focusGesture && contextStrokes.length) {
    // A second view zooms around the gesture, without choosing an endpoint.
    // The complete, identically oriented connector remains in the first view.
    const gesture = paths.at(-1);
    const left = Math.min(...gesture.map((p) => p.x)), right = Math.max(...gesture.map((p) => p.x));
    const top = Math.min(...gesture.map((p) => p.y)), bottom = Math.max(...gesture.map((p) => p.y));
    const shaft = paths[0];
    const length = Math.hypot(shaft.at(-1).x - shaft[0].x, shaft.at(-1).y - shaft[0].y);
    width = height = Math.max(right - left, bottom - top, length * 0.18, 1) * 1.6;
    minX = (left + right - width) / 2;
    minY = (top + bottom - height) / 2;
  }
  const extent = Math.max(width, height, 1);
  const scale = 208 / extent;
  const offsetX = (256 - width * scale) / 2;
  const offsetY = (256 - height * scale) / 2;
  const pathElements = paths.map((points, index) => {
    const path = points.map((point, index) => `${index ? "L" : "M"}${((point.x - minX) * scale + offsetX).toFixed(2)},${((point.y - minY) * scale + offsetY).toFixed(2)}`).join(" ");
    const color = contextStrokes.length && index === paths.length - 1 ? "#2455dd" : "black";
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join("");
  // All SVG coordinates are generated from finite numbers, never raw strings.
  // Keep an open path: automatically closing it would conceal real drawing gaps.
  const labels = contextStrokes.length ? [[paths[0][0], "TAIL"], [paths[0].at(-1), "HEAD"]].map(([point, label]) =>
    `<text x="${((point.x - minX) * scale + offsetX + 8).toFixed(2)}" y="${((point.y - minY) * scale + offsetY).toFixed(2)}" fill="#777" font-family="sans-serif" font-size="9">${label}</text>`).join("") : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="white"/>${pathElements}${labels}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
