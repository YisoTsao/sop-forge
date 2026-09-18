import type { EditorDocument, EditorObject } from "../../domain/src/index.js";
import { sourceToOutputPoint } from "./editor-core.js";

export type EditorRenderMode = "static" | "editable";

export interface EditorSvgOptions {
  mode?: EditorRenderMode;
  className?: string;
  label?: string;
}

export function renderEditorSvg(
  document: EditorDocument,
  options: EditorSvgOptions = {},
): string {
  const mode = options.mode ?? "static";
  const className = options.className ?? "annotation-overlay";
  const label = escapeMarkup(options.label ?? "Screenshot annotations");
  const markerIds = document.objects
    .filter((object): object is Extract<EditorObject, { type: "arrow" | "line" }> =>
      object.type === "arrow" || object.type === "line")
    .flatMap((object) => [
      object.startHead,
      object.endHead ?? (object.type === "arrow" ? "triangle" : undefined),
    ].filter((head): head is "triangle" | "open" => head === "triangle" || head === "open").map((head) => markerId(object.id, head)))
    .map((id) => markerMarkup(id))
    .join("");
  const objects = document.objects
    .filter((object) => !object.hidden)
    .map((object) => renderObject(document, object, mode))
    .join("");
  return `<svg class="${escapeMarkup(className)}" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="${label}"><defs>${markerIds}</defs>${objects}</svg>`;
}

function renderObject(document: EditorDocument, object: EditorObject, mode: EditorRenderMode): string {
  const common = `class="editor-object editor-object-${object.type}" data-editor-object-id="${escapeMarkup(object.id)}"${mode === "editable" ? " tabindex=\"0\"" : ""}`;
  const style = `stroke="${object.style.stroke}" stroke-width="${object.style.strokeWidth}" opacity="${object.style.opacity}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
  if (object.type === "circle") {
    const center = sourceToOutputPoint(document, { x: object.x, y: object.y });
    const edge = sourceToOutputPoint(document, { x: object.x + object.radius, y: object.y });
    const radius = Math.max(Math.abs(edge.x - center.x), Math.abs(edge.y - center.y));
    return `<circle ${common} cx="${center.x}" cy="${center.y}" r="${radius}" fill="${object.style.fill ?? "none"}" ${style} ${rotationTransform(document, object)}/>`;
  }
  if (object.type === "rectangle" || object.type === "redaction" || object.type === "callout") {
    const topLeft = sourceToOutputPoint(document, { x: object.x, y: object.y });
    const bottomRight = sourceToOutputPoint(document, { x: object.x + object.width, y: object.y + object.height });
    const bounds = {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y),
    };
    const fill = object.type === "redaction" ? object.style.fill ?? "#17231d" : object.style.fill ?? "none";
    const redactionMode = object.type === "redaction" ? ` data-redaction-mode="${object.mode}"` : "";
    const rectangle = `<rect ${common}${redactionMode} x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${fill}" ${style} ${rotationTransform(document, object)}/>`;
    if (object.type === "callout") {
      const pointer = sourceToOutputPoint(document, object.pointer);
      return `${rectangle}<line ${common} x1="${pointer.x}" y1="${pointer.y}" x2="${bounds.x + bounds.width / 2}" y2="${bounds.y + bounds.height / 2}" fill="none" ${style} ${rotationTransform(document, object)}/><text ${common} x="${bounds.x + 0.02}" y="${bounds.y + 0.02}" fill="${object.style.stroke}" font-size="${object.style.fontSize ?? 0.04}" dominant-baseline="hanging" ${rotationTransform(document, object)}>${escapeMarkup(object.text)}</text>`;
    }
    return rectangle;
  }
  if (object.type === "line" || object.type === "arrow") {
    const start = sourceToOutputPoint(document, { x: object.x1, y: object.y1 });
    const end = sourceToOutputPoint(document, { x: object.x2, y: object.y2 });
    const startMarker = object.startHead && object.startHead !== "none" ? ` marker-start="url(#${markerId(object.id, object.startHead)})"` : "";
    const endMarker = object.endHead && object.endHead !== "none" ? ` marker-end="url(#${markerId(object.id, object.endHead)})"` : object.type === "arrow" ? ` marker-end="url(#${markerId(object.id, "triangle")})"` : "";
    return `<line ${common} x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" fill="none" ${style}${startMarker}${endMarker} ${rotationTransform(document, object)}/>`;
  }
  if (object.type === "path") {
    const points = object.points.map((point) => sourceToOutputPoint(document, point));
    const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
    return `<path ${common} d="${path}" fill="none" ${style} ${rotationTransform(document, object)}/>`;
  }
  if (object.type === "marker") {
    const point = sourceToOutputPoint(document, { x: object.x, y: object.y });
    return `<circle ${common} cx="${point.x}" cy="${point.y}" r="0.035" fill="${object.style.fill ?? object.style.stroke}" ${style} ${rotationTransform(document, object)}/><text ${common} x="${point.x}" y="${point.y}" fill="#fff" font-size="0.03" text-anchor="middle" dominant-baseline="central" ${rotationTransform(document, object)}>${escapeMarkup(object.label)}</text>`;
  }
  const point = sourceToOutputPoint(document, { x: object.x, y: object.y });
  const textAnchor = object.style.textAlign === "center" ? "middle" : object.style.textAlign === "right" ? "end" : "start";
  return `<text ${common} x="${point.x}" y="${point.y}" fill="${object.style.stroke}" font-size="${object.style.fontSize ?? 0.04}" font-family="${escapeMarkup(object.style.fontFamily ?? "sans-serif")}" font-weight="${object.style.fontWeight ?? 400}" text-anchor="${textAnchor}" dominant-baseline="hanging" ${rotationTransform(document, object)}>${escapeMarkup(object.text)}</text>`;
}

function rotationTransform(document: EditorDocument, object: EditorObject): string {
  if (!object.rotation) return "";
  const bounds = object.type === "line" || object.type === "arrow"
    ? { x: (object.x1 + object.x2) / 2, y: (object.y1 + object.y2) / 2 }
    : object.type === "path"
      ? { x: (object.points[0]?.x ?? 0) + getPathWidth(object) / 2, y: (object.points[0]?.y ?? 0) + getPathHeight(object) / 2 }
      : { x: getObjectCenter(object).x, y: getObjectCenter(object).y };
  const center = sourceToOutputPoint(document, bounds);
  return `transform="rotate(${object.rotation} ${center.x} ${center.y})"`;
}

function getObjectCenter(object: EditorObject): { x: number; y: number } {
  if (object.type === "circle" || object.type === "text" || object.type === "marker") return { x: object.x, y: object.y };
  if (object.type === "line" || object.type === "arrow") return { x: (object.x1 + object.x2) / 2, y: (object.y1 + object.y2) / 2 };
  if (object.type === "path") {
    return {
      x: (Math.min(...object.points.map((point) => point.x)) + Math.max(...object.points.map((point) => point.x))) / 2,
      y: (Math.min(...object.points.map((point) => point.y)) + Math.max(...object.points.map((point) => point.y))) / 2,
    };
  }
  return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
}

function getPathWidth(object: Extract<EditorObject, { type: "path" }>): number {
  return Math.max(...object.points.map((point) => point.x)) - Math.min(...object.points.map((point) => point.x));
}

function getPathHeight(object: Extract<EditorObject, { type: "path" }>): number {
  return Math.max(...object.points.map((point) => point.y)) - Math.min(...object.points.map((point) => point.y));
}

function markerMarkup(id: string): string {
  const open = id.endsWith("-open");
  const path = open ? "M0,0 L0.05,0.025 L0,0.05" : "M0,0 L0.05,0.025 L0,0.05 Z";
  return `<marker id="${id}" markerWidth="0.05" markerHeight="0.05" refX="0.045" refY="0.025" orient="auto" markerUnits="userSpaceOnUse"><path d="${path}" fill="${open ? "none" : "currentColor"}" stroke="currentColor"/></marker>`;
}

function markerId(id: string, head: "triangle" | "open"): string {
  return `editor-arrowhead-${escapeMarkup(id)}-${head}`;
}

function escapeMarkup(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
