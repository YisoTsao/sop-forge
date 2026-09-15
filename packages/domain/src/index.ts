import { z } from "zod";

const isoTimestamp = z.iso.datetime({ offset: true });
const coordinatesSchema = z.object({ x: z.number(), y: z.number() });
const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const targetSchema = z.object({
  coordinates: coordinatesSchema.optional(),
  boundingBox: boundingBoxSchema.optional(),
  tagName: z.string().optional(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  visibleText: z.string().optional(),
  locatorCandidates: z.array(z.string()),
  framePath: z.array(z.string()),
  shadowDomPath: z.array(z.string()),
});

export const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["original", "annotated", "resized"]),
  status: z.enum(["pending", "ready", "failed", "unavailable"]),
  relativePath: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  error: z.string().optional(),
});

const normalizedCoordinate = z.number().min(0).max(1);
const annotationColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const annotationBaseSchema = z.object({
  id: z.string().min(1),
  color: annotationColor,
});
export const annotationSchema = z.discriminatedUnion("type", [
  annotationBaseSchema.extend({
    type: z.literal("circle"),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    radius: z.number().positive().max(1),
  }),
  annotationBaseSchema.extend({
    type: z.literal("rectangle"),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  }),
  annotationBaseSchema.extend({
    type: z.literal("arrow"),
    x1: normalizedCoordinate,
    y1: normalizedCoordinate,
    x2: normalizedCoordinate,
    y2: normalizedCoordinate,
  }),
  annotationBaseSchema.extend({
    type: z.literal("text"),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    text: z.string().min(1),
    fontSize: z.number().positive().max(1),
  }),
]);

export const stepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  action: z.enum([
    "navigation",
    "click",
    "input",
    "select",
    "keypress",
    "informational",
    "unsupported",
  ]),
  title: z.string().min(1),
  description: z.string(),
  sourceEventIds: z.array(z.string().min(1)),
  target: targetSchema.optional(),
  screenshotAssetId: z.string().min(1).optional(),
  annotations: z.array(annotationSchema).optional(),
});

const eventBaseSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: isoTimestamp,
});

export const rawEventSchema = z.discriminatedUnion("type", [
  eventBaseSchema.extend({
    type: z.literal("navigation"),
    navigation: z.object({ url: z.url() }),
  }),
  eventBaseSchema.extend({
    type: z.literal("click"),
    coordinates: coordinatesSchema,
    target: targetSchema.optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("input"),
    input: z.object({
      name: z.string().optional(),
      inputType: z.string().optional(),
      value: z.string(),
      redacted: z.boolean(),
    }),
    target: targetSchema.optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("select"),
    select: z.object({ name: z.string().optional(), value: z.string() }),
    target: targetSchema.optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("keypress"),
    key: z.string().min(1),
    target: targetSchema.optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("unsupported"),
    detail: z.string().min(1),
  }),
]);

export const sessionStatusSchema = z.enum([
  "starting",
  "recording",
  "stopping",
  "completed",
  "failed",
  "interrupted",
]);
export const assetStatusSchema = z.enum([
  "pending",
  "ready",
  "failed",
  "unavailable",
]);
export const redactionPolicySchema = z.object({
  redacted: z.boolean(),
  reason: z.string().optional(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  sourceUrl: z.url(),
  status: sessionStatusSchema,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  steps: z.array(stepSchema),
  assets: z.array(assetSchema),
});

export const createSessionRequestSchema = z.object({ url: z.string().min(1) });
export const sessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
});
export const projectListSchema = z.array(projectSchema);
export const pdfResponseSchema = z.object({
  path: z.string().min(1),
  url: z.string().min(1),
});

export type Coordinates = z.infer<typeof coordinatesSchema>;
export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type Step = z.infer<typeof stepSchema>;
export type RawEvent = z.infer<typeof rawEventSchema>;
export type Project = z.infer<typeof projectSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type RedactionPolicy = z.infer<typeof redactionPolicySchema>;

export const DOMAIN_SCHEMA_VERSION = 1 as const;
