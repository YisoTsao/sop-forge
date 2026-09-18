import sharp from "sharp";
import type { BoundingBox, Coordinates } from "../../domain/src/index.js";

export interface AnnotationGeometry {
  coordinates?: Coordinates;
  boundingBox?: BoundingBox;
  deviceScaleFactor?: number;
}

export interface AnnotationResult {
  buffer: Buffer;
  annotated: boolean;
}

function escapeSvg(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

export async function annotateScreenshot(
  input: Buffer,
  geometry: AnnotationGeometry,
): Promise<AnnotationResult> {
  if (!geometry.coordinates && !geometry.boundingBox) {
    return { buffer: input, annotated: false };
  }

  const metadata = await sharp(input).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const scale = geometry.deviceScaleFactor ?? 1;
  const coordinate = geometry.coordinates
    ? { x: geometry.coordinates.x * scale, y: geometry.coordinates.y * scale }
    : undefined;
  const boundingBox = geometry.boundingBox
    ? {
        x: geometry.boundingBox.x * scale,
        y: geometry.boundingBox.y * scale,
        width: geometry.boundingBox.width * scale,
        height: geometry.boundingBox.height * scale,
      }
    : undefined;

  const markerPoint = coordinate ?? (boundingBox
    ? {
        x: boundingBox.x + boundingBox.width / 2,
        y: boundingBox.y + boundingBox.height / 2,
      }
    : undefined);
  const marker = markerPoint
    ? `<circle cx="${escapeSvg(markerPoint.x)}" cy="${escapeSvg(markerPoint.y)}" r="18" fill="none" stroke="#ff7a45" stroke-width="4"/><circle cx="${escapeSvg(markerPoint.x)}" cy="${escapeSvg(markerPoint.y)}" r="4" fill="#ff7a45"/>`
    : "";
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${marker}</svg>`,
  );
  const buffer = await sharp(input)
    .composite([{ input: overlay }])
    .png()
    .toBuffer();
  return { buffer, annotated: true };
}
