import type {
  Annotation,
  EditorDocument,
  EditorImageTransform,
  EditorObject,
  EditorStyle,
} from "../../domain/src/index.js";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export type CropAspect = "free" | "original" | "1:1" | "4:3" | "16:9";

export type EditorCommand =
  | { type: "create-object"; object: EditorObject }
  | { type: "update-object"; id: string; changes: Partial<EditorObject> }
  | { type: "move-object"; id: string; dx: number; dy: number }
  | { type: "resize-object"; id: string; width: number; height: number }
  | { type: "rotate-object"; id: string; rotation: number }
  | { type: "set-object-style"; ids: string[]; style: Partial<EditorStyle> }
  | { type: "delete-objects"; ids: string[] }
  | {
      type: "reorder-object";
      id: string;
      direction: "forward" | "backward" | "front" | "back";
    }
  | { type: "group-objects"; ids: string[]; groupId: string }
  | { type: "ungroup-objects"; groupId: string }
  | { type: "set-crop"; crop: EditorImageTransform["crop"] }
  | { type: "set-image-transform"; transform: Partial<EditorImageTransform> };

export interface EditorHistory {
  readonly past: readonly EditorDocument[];
  readonly present: EditorDocument;
  readonly future: readonly EditorDocument[];
}

export interface EditorSelection {
  readonly ids: readonly string[];
  readonly activeId?: string;
  readonly handle?: "move" | "resize" | "rotate" | "crop";
  readonly mode: "select" | "crop" | "pan";
}

export const emptyEditorSelection: EditorSelection = {
  ids: [],
  mode: "select",
};

const DEFAULT_STYLE: EditorStyle = {
  stroke: "#ff7a45",
  opacity: 1,
  strokeWidth: 0.006,
};

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp(rect.x);
  const y = clamp(rect.y);
  const right = clamp(rect.x + rect.width);
  const bottom = clamp(rect.y + rect.height);
  return {
    x,
    y,
    width: roundNormalized(Math.max(0, right - x)),
    height: roundNormalized(Math.max(0, bottom - y)),
  };
}

export function clampCropRect(
  rect: NormalizedRect,
  options: { document: EditorDocument; aspect?: CropAspect; minSize?: number },
): NormalizedRect {
  const minimum = Math.min(0.5, Math.max(0.001, options.minSize ?? 0.02));
  const bounded = normalizeRect({
    x: rect.x,
    y: rect.y,
    width: Math.max(minimum, rect.width),
    height: Math.max(minimum, rect.height),
  });
  const aspect = normalizedCropAspect(
    options.document,
    options.aspect ?? "free",
  );
  if (!aspect) return fitRectInsideBounds(bounded, minimum);

  let width = Math.max(minimum, bounded.width);
  let height = Math.max(minimum, bounded.height);
  if (width / height > aspect) width = height * aspect;
  else height = width / aspect;
  if (width > 1) {
    width = 1;
    height = width / aspect;
  }
  if (height > 1) {
    height = 1;
    width = height * aspect;
  }
  return fitRectInsideBounds(
    {
      x: bounded.x + (bounded.width - width) / 2,
      y: bounded.y + (bounded.height - height) / 2,
      width,
      height,
    },
    minimum,
  );
}

export function setCropAspectRatio(
  document: EditorDocument,
  aspect: CropAspect,
): EditorDocument {
  return {
    ...document,
    imageTransform: {
      ...document.imageTransform,
      crop: clampCropRect(document.imageTransform.crop, { document, aspect }),
    },
  };
}

export function rotateImageTransform(
  transform: EditorImageTransform,
  direction: "left" | "right",
): EditorImageTransform {
  const delta = direction === "right" ? 90 : 270;
  return {
    ...transform,
    rotation: ((transform.rotation + delta) %
      360) as EditorImageTransform["rotation"],
  };
}

export function toggleImageFlip(
  transform: EditorImageTransform,
  axis: "horizontal" | "vertical",
): EditorImageTransform {
  return {
    ...transform,
    flipX: axis === "horizontal" ? !transform.flipX : transform.flipX,
    flipY: axis === "vertical" ? !transform.flipY : transform.flipY,
  };
}

function normalizedCropAspect(
  document: EditorDocument,
  aspect: CropAspect,
): number | undefined {
  if (aspect === "free") return undefined;
  const pixelAspect =
    aspect === "original"
      ? document.source.width / document.source.height
      : aspect === "1:1"
        ? 1
        : aspect === "4:3"
          ? 4 / 3
          : 16 / 9;
  return (pixelAspect * document.source.height) / document.source.width;
}

function fitRectInsideBounds(
  rect: NormalizedRect,
  minimum: number,
): NormalizedRect {
  const width = Math.min(1, Math.max(minimum, rect.width));
  const height = Math.min(1, Math.max(minimum, rect.height));
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height,
  };
}

export function createEditorDocument(
  sourceWidth: number,
  sourceHeight: number,
  objects: EditorObject[] = [],
): EditorDocument {
  if (!Number.isInteger(sourceWidth) || sourceWidth <= 0) {
    throw new Error("sourceWidth must be a positive integer");
  }
  if (!Number.isInteger(sourceHeight) || sourceHeight <= 0) {
    throw new Error("sourceHeight must be a positive integer");
  }

  return {
    editorVersion: 1,
    source: { width: sourceWidth, height: sourceHeight },
    imageTransform: {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    objects: [...objects],
  };
}

export function normalizeEditorDocument(
  document: EditorDocument,
): EditorDocument {
  const crop = normalizeRect(document.imageTransform.crop);
  return {
    ...document,
    imageTransform: {
      ...document.imageTransform,
      crop: {
        ...crop,
        width: Math.max(Number.EPSILON, crop.width),
        height: Math.max(Number.EPSILON, crop.height),
      },
    },
    objects: document.objects.map((object) => ({
      ...object,
      rotation: normalizeAngle(object.rotation),
    })),
  };
}

export function normalizeAngle(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function getImageOutputSize(document: EditorDocument): ImageSize {
  const crop = document.imageTransform.crop;
  const width = Math.round(document.source.width * crop.width);
  const height = Math.round(document.source.height * crop.height);
  return document.imageTransform.rotation === 90 ||
    document.imageTransform.rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

export function sourceToOutputPoint(
  document: EditorDocument,
  point: NormalizedPoint,
): NormalizedPoint {
  const { crop, rotation, flipX, flipY } = document.imageTransform;
  const cropped = {
    x: (point.x - crop.x) / crop.width,
    y: (point.y - crop.y) / crop.height,
  };
  const rotated = rotateCroppedPoint(cropped, rotation);
  return {
    x: roundNormalized(flipX ? 1 - rotated.x : rotated.x),
    y: roundNormalized(flipY ? 1 - rotated.y : rotated.y),
  };
}

export function outputToSourcePoint(
  document: EditorDocument,
  point: NormalizedPoint,
): NormalizedPoint {
  const { crop, rotation, flipX, flipY } = document.imageTransform;
  const unflipped = {
    x: flipX ? 1 - point.x : point.x,
    y: flipY ? 1 - point.y : point.y,
  };
  const cropped = inverseRotateCroppedPoint(unflipped, rotation);
  return {
    x: roundNormalized(crop.x + cropped.x * crop.width),
    y: roundNormalized(crop.y + cropped.y * crop.height),
  };
}

function rotateCroppedPoint(
  point: NormalizedPoint,
  rotation: EditorDocument["imageTransform"]["rotation"],
): NormalizedPoint {
  if (rotation === 90) return { x: 1 - point.y, y: point.x };
  if (rotation === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (rotation === 270) return { x: point.y, y: 1 - point.x };
  return point;
}

function inverseRotateCroppedPoint(
  point: NormalizedPoint,
  rotation: EditorDocument["imageTransform"]["rotation"],
): NormalizedPoint {
  if (rotation === 90) return { x: point.y, y: 1 - point.x };
  if (rotation === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (rotation === 270) return { x: 1 - point.y, y: point.x };
  return point;
}

function roundNormalized(value: number): number {
  return Number(value.toFixed(12));
}

export function getObjectBounds(object: EditorObject): NormalizedRect {
  if (object.type === "circle") {
    return {
      x: object.x - object.radius,
      y: object.y - object.radius,
      width: object.radius * 2,
      height: object.radius * 2,
    };
  }
  if (
    object.type === "rectangle" ||
    object.type === "callout" ||
    object.type === "redaction"
  ) {
    return {
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
    };
  }
  if (object.type === "marker" || object.type === "text") {
    return { x: object.x, y: object.y, width: 0, height: 0 };
  }
  if (object.type === "line" || object.type === "arrow") {
    return {
      x: Math.min(object.x1, object.x2),
      y: Math.min(object.y1, object.y2),
      width: Math.abs(object.x2 - object.x1),
      height: Math.abs(object.y2 - object.y1),
    };
  }

  const xs = object.points.map((point) => point.x);
  const ys = object.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function hitTest(
  document: EditorDocument,
  point: NormalizedPoint,
): string | undefined {
  for (let index = document.objects.length - 1; index >= 0; index -= 1) {
    const object = document.objects[index];
    if (!object || object.hidden) continue;
    if (isPointInObject(object, point)) return object.id;
  }
  return undefined;
}

function isPointInObject(
  object: EditorObject,
  point: NormalizedPoint,
): boolean {
  const bounds = getObjectBounds(object);
  if (object.type === "circle") {
    const dx = point.x - object.x;
    const dy = point.y - object.y;
    return dx * dx + dy * dy <= object.radius * object.radius;
  }
  if (object.type === "line" || object.type === "arrow") {
    return (
      distanceToSegment(
        point,
        { x: object.x1, y: object.y1 },
        { x: object.x2, y: object.y2 },
      ) <= hitTolerance(object.style)
    );
  }
  if (object.type === "path") {
    return object.points.some((start, index) => {
      const end = object.points[index + 1];
      return end
        ? distanceToSegment(point, start, end) <= hitTolerance(object.style)
        : false;
    });
  }
  if (object.type === "text" || object.type === "marker") {
    return (
      Math.abs(point.x - bounds.x) <= 0.04 &&
      Math.abs(point.y - bounds.y) <= 0.04
    );
  }
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function hitTolerance(style: EditorStyle): number {
  return Math.max(style.strokeWidth * 2, 0.018);
}

function distanceToSegment(
  point: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const ratio = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
  );
  const closestX = start.x + ratio * dx;
  const closestY = start.y + ratio * dy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

export function defaultEditorStyle(
  overrides: Partial<EditorStyle> = {},
): EditorStyle {
  return { ...DEFAULT_STYLE, ...overrides };
}

export function editorDocumentFromLegacyAnnotations(
  sourceWidth: number,
  sourceHeight: number,
  annotations: readonly Annotation[] = [],
): EditorDocument {
  const objects: EditorObject[] = annotations.map((annotation) => {
    const style = defaultEditorStyle({ stroke: annotation.color });
    if (annotation.type === "circle") {
      return {
        id: annotation.id,
        type: "circle",
        x: annotation.x,
        y: annotation.y,
        radius: annotation.radius,
        rotation: annotation.rotation ?? 0,
        style,
      };
    }
    if (annotation.type === "rectangle") {
      return {
        id: annotation.id,
        type: "rectangle",
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        rotation: annotation.rotation ?? 0,
        style,
      };
    }
    if (annotation.type === "arrow") {
      return {
        id: annotation.id,
        type: "arrow",
        x1: annotation.x1,
        y1: annotation.y1,
        x2: annotation.x2,
        y2: annotation.y2,
        endHead: "triangle",
        rotation: annotation.rotation ?? 0,
        style,
      };
    }
    return {
      id: annotation.id,
      type: "text",
      x: annotation.x,
      y: annotation.y,
      text: annotation.text,
      rotation: annotation.rotation ?? 0,
      style: defaultEditorStyle({
        stroke: annotation.color,
        fontSize: annotation.fontSize,
      }),
    };
  });
  return createEditorDocument(sourceWidth, sourceHeight, objects);
}

export function createEditorHistory(document: EditorDocument): EditorHistory {
  return { past: [], present: document, future: [] };
}

export function applyCommand(
  history: EditorHistory,
  command: EditorCommand,
): EditorHistory {
  const present = applyCommandToDocument(history.present, command);
  return {
    past: [...history.past, history.present],
    present,
    future: [],
  };
}

export function applyCommandToDocument(
  document: EditorDocument,
  command: EditorCommand,
): EditorDocument {
  if (command.type === "create-object") {
    if (document.objects.some((object) => object.id === command.object.id)) {
      throw new Error(`Object already exists: ${command.object.id}`);
    }
    return { ...document, objects: [...document.objects, command.object] };
  }

  if (command.type === "update-object") {
    const objectIndex = document.objects.findIndex(
      (object) => object.id === command.id,
    );
    if (objectIndex < 0) throw new Error(`Object not found: ${command.id}`);
    const objects = [...document.objects];
    objects[objectIndex] = {
      ...objects[objectIndex],
      ...command.changes,
    } as EditorObject;
    return { ...document, objects };
  }

  if (command.type === "move-object") {
    const object = findObject(document, command.id);
    return {
      ...document,
      objects: document.objects.map((candidate) =>
        candidate.id === object.id
          ? moveObject(candidate, command.dx, command.dy)
          : candidate,
      ),
    };
  }

  if (command.type === "resize-object") {
    const object = findObject(document, command.id);
    if (!("width" in object && "height" in object)) {
      throw new Error(`Object cannot be resized: ${command.id}`);
    }
    return {
      ...document,
      objects: document.objects.map((candidate) =>
        candidate.id === object.id
          ? ({
              ...candidate,
              width: clamp(command.width),
              height: clamp(command.height),
            } as EditorObject)
          : candidate,
      ),
    };
  }

  if (command.type === "rotate-object") {
    findObject(document, command.id);
    return {
      ...document,
      objects: document.objects.map((object) =>
        object.id === command.id
          ? { ...object, rotation: command.rotation }
          : object,
      ),
    };
  }

  if (command.type === "set-object-style") {
    const ids = new Set(command.ids);
    return {
      ...document,
      objects: document.objects.map((object) =>
        ids.has(object.id)
          ? { ...object, style: { ...object.style, ...command.style } }
          : object,
      ),
    };
  }

  if (command.type === "delete-objects") {
    const ids = new Set(command.ids);
    return {
      ...document,
      objects: document.objects.filter((object) => !ids.has(object.id)),
    };
  }

  if (command.type === "reorder-object") {
    const index = document.objects.findIndex(
      (object) => object.id === command.id,
    );
    if (index < 0) throw new Error(`Object not found: ${command.id}`);
    const objects = [...document.objects];
    const [object] = objects.splice(index, 1);
    if (!object) return document;
    const targetIndex =
      command.direction === "front"
        ? objects.length
        : command.direction === "back"
          ? 0
          : command.direction === "forward"
            ? Math.min(objects.length, index + 1)
            : Math.max(0, index - 1);
    objects.splice(targetIndex, 0, object);
    return { ...document, objects };
  }

  if (command.type === "group-objects") {
    const ids = new Set(command.ids);
    return {
      ...document,
      objects: document.objects.map((object) =>
        ids.has(object.id) ? { ...object, groupId: command.groupId } : object,
      ),
    };
  }

  if (command.type === "ungroup-objects") {
    return {
      ...document,
      objects: document.objects.map((object) =>
        object.groupId === command.groupId ? withoutGroupId(object) : object,
      ),
    };
  }

  if (command.type === "set-crop") {
    return {
      ...document,
      imageTransform: {
        ...document.imageTransform,
        crop: clampCropRect(command.crop, { document }),
      },
    };
  }

  return {
    ...document,
    imageTransform: {
      ...document.imageTransform,
      ...command.transform,
      crop: command.transform.crop
        ? clampCropRect(command.transform.crop, { document })
        : document.imageTransform.crop,
    },
  };
}

function findObject(document: EditorDocument, id: string): EditorObject {
  const object = document.objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error(`Object not found: ${id}`);
  return object;
}

function moveObject(
  object: EditorObject,
  dx: number,
  dy: number,
): EditorObject {
  if (object.type === "line" || object.type === "arrow") {
    return {
      ...object,
      x1: clamp(object.x1 + dx),
      y1: clamp(object.y1 + dy),
      x2: clamp(object.x2 + dx),
      y2: clamp(object.y2 + dy),
    };
  }
  if (object.type === "path") {
    return {
      ...object,
      points: object.points.map((point) => ({
        x: clamp(point.x + dx),
        y: clamp(point.y + dy),
      })),
    };
  }
  if (object.type === "callout") {
    return {
      ...object,
      x: clamp(object.x + dx),
      y: clamp(object.y + dy),
      pointer: {
        x: clamp(object.pointer.x + dx),
        y: clamp(object.pointer.y + dy),
      },
    };
  }
  return { ...object, x: clamp(object.x + dx), y: clamp(object.y + dy) };
}

export function undo(history: EditorHistory): EditorHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

function withoutGroupId(object: EditorObject): EditorObject {
  const { groupId: _groupId, ...ungrouped } = object;
  return ungrouped as EditorObject;
}
