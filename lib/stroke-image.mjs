import sharp from "sharp";

export async function renderStrokeImage(rawPoints, contextStrokes = []) {
  const valid = (points) => points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  const paths = [...contextStrokes.map(valid), valid(rawPoints)];
  const points = paths.flat();
  if (points.length < 2) throw new Error("Draw a longer stroke.");
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const width = Math.max(...points.map((point) => point.x)) - minX;
  const height = Math.max(...points.map((point) => point.y)) - minY;
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="white"/>${pathElements}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
