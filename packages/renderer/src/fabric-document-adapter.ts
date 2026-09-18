import type {
  Annotation,
  EditorDocument,
  EditorObject,
  EditorStyle,
} from "../../domain/src/index.js";
import {
  createEditorDocument,
  editorDocumentFromLegacyAnnotations,
} from "./editor-core.js";

export interface FabricObjectDescriptor {
  id: string;
  type: string;
  editorType: EditorObject["type"];
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  radius?: number;
  radiusX?: number;
  radiusY?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: Array<{ x: number; y: number }>;
  text?: string;
  label?: string;
  pointer?: { x: number; y: number };
  angle: number;
  scaleX: number;
  scaleY: number;
  style: EditorStyle;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  mode?: "pen" | "highlighter" | "solid" | "pixelate";
  startHead?: "none" | "triangle" | "open";
  endHead?: "none" | "triangle" | "open";
}

export function editorDocumentToFabricObjects(
  document: EditorDocument,
): FabricObjectDescriptor[] {
  return document.objects.map((object) => toDescriptor(object, document));
}

export function fabricObjectsToEditorDocument(
  document: EditorDocument,
  descriptors: readonly FabricObjectDescriptor[],
): EditorDocument {
  const objects = descriptors.map((descriptor) =>
    fromDescriptor(descriptor, document),
  );
  return { ...document, objects };
}

export function legacyAnnotationsToEditorDocument(
  sourceWidth: number,
  sourceHeight: number,
  annotations: readonly Annotation[] = [],
): EditorDocument {
  return editorDocumentFromLegacyAnnotations(
    sourceWidth,
    sourceHeight,
    annotations,
  );
}

function toDescriptor(
  object: EditorObject,
  document: EditorDocument,
): FabricObjectDescriptor {
  const width = document.source.width;
  const height = document.source.height;
  const base = {
    id: object.id,
    editorType: object.type,
    angle: object.rotation,
    scaleX: 1,
    scaleY: 1,
    style: object.style,
    hidden: object.hidden,
    locked: object.locked,
    groupId: object.groupId,
  };

  if (object.type === "circle") {
    return {
      ...base,
      type: "ellipse",
      radiusX: object.radius * width,
      radiusY: object.radius * height,
    };
  }
  if (object.type === "rectangle") {
    return {
      ...base,
      type: "rect",
      left: object.x * width,
      top: object.y * height,
      width: object.width * width,
      height: object.height * height,
    };
  }
  if (object.type === "redaction") {
    return {
      ...base,
      type: "rect",
      left: object.x * width,
      top: object.y * height,
      width: object.width * width,
      height: object.height * height,
      mode: object.mode,
    };
  }
  if (object.type === "callout") {
    return {
      ...base,
      type: "rect",
      left: object.x * width,
      top: object.y * height,
      width: object.width * width,
      height: object.height * height,
      text: object.text,
      pointer: { x: object.pointer.x * width, y: object.pointer.y * height },
    };
  }
  if (object.type === "line" || object.type === "arrow") {
    return {
      ...base,
      type: object.type,
      x1: object.x1 * width,
      y1: object.y1 * height,
      x2: object.x2 * width,
      y2: object.y2 * height,
      startHead: object.startHead,
      endHead: object.endHead,
    };
  }
  if (object.type === "path") {
    return {
      ...base,
      type: "path",
      points: object.points.map((point) => ({
        x: point.x * width,
        y: point.y * height,
      })),
      mode: object.mode,
    };
  }
  if (object.type === "text") {
    return {
      ...base,
      type: "i-text",
      left: object.x * width,
      top: object.y * height,
      text: object.text,
    };
  }
  return {
    ...base,
    type: "marker",
    left: object.x * width,
    top: object.y * height,
    label: object.label,
  };
}

function fromDescriptor(
  descriptor: FabricObjectDescriptor,
  document: EditorDocument,
): EditorObject {
  const width = document.source.width;
  const height = document.source.height;
  const base = {
    id: descriptor.id,
    rotation: descriptor.angle,
    style: descriptor.style,
    hidden: descriptor.hidden,
    locked: descriptor.locked,
    groupId: descriptor.groupId,
  };

  if (descriptor.editorType === "circle") {
    return {
      ...base,
      type: "circle",
      x: (descriptor.left ?? 0) / width,
      y: (descriptor.top ?? 0) / height,
      radius: (descriptor.radiusX ?? descriptor.radius ?? 0) / width,
    };
  }
  if (
    descriptor.editorType === "rectangle" ||
    descriptor.editorType === "redaction" ||
    descriptor.editorType === "callout"
  ) {
    const rectangle = {
      x: (descriptor.left ?? 0) / width,
      y: (descriptor.top ?? 0) / height,
      width: (descriptor.width ?? 0) / width,
      height: (descriptor.height ?? 0) / height,
    };
    if (descriptor.editorType === "redaction") {
      return {
        ...base,
        ...rectangle,
        type: "redaction",
        mode: descriptor.mode === "pixelate" ? "pixelate" : "solid",
      };
    }
    if (descriptor.editorType === "callout") {
      return {
        ...base,
        ...rectangle,
        type: "callout",
        text: descriptor.text ?? "Callout",
        pointer: {
          x: (descriptor.pointer?.x ?? descriptor.left ?? 0) / width,
          y: (descriptor.pointer?.y ?? descriptor.top ?? 0) / height,
        },
      };
    }
    return { ...base, ...rectangle, type: "rectangle" };
  }
  if (descriptor.editorType === "line" || descriptor.editorType === "arrow") {
    return {
      ...base,
      type: descriptor.editorType,
      x1: (descriptor.x1 ?? 0) / width,
      y1: (descriptor.y1 ?? 0) / height,
      x2: (descriptor.x2 ?? 0) / width,
      y2: (descriptor.y2 ?? 0) / height,
      startHead: descriptor.startHead,
      endHead: descriptor.endHead,
    };
  }
  if (descriptor.editorType === "path") {
    return {
      ...base,
      type: "path",
      points: (descriptor.points ?? []).map((point) => ({
        x: point.x / width,
        y: point.y / height,
      })),
      mode: descriptor.mode === "highlighter" ? "highlighter" : "pen",
    };
  }
  if (descriptor.editorType === "text") {
    return {
      ...base,
      type: "text",
      x: (descriptor.left ?? 0) / width,
      y: (descriptor.top ?? 0) / height,
      text: descriptor.text ?? "Text",
    };
  }
  return {
    ...base,
    type: "marker",
    x: (descriptor.left ?? 0) / width,
    y: (descriptor.top ?? 0) / height,
    label: descriptor.label ?? "1",
  };
}
