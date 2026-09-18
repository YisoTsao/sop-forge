import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  projectSchema,
  type Annotation,
  type Project,
} from "../../domain/src/index.js";
import { renderEditableScript } from "./annotation-editor.js";
import { editorDocumentFromLegacyAnnotations } from "./editor-core.js";
import { renderEditorSvg } from "./editor-svg.js";
import { renderFabricEditorRuntime } from "./fabric-editor-runtime.js";

const require = createRequire(import.meta.url);

function fabricBrowserBundle(): string {
  return readFileSync(require.resolve("fabric"), "utf8").replaceAll(
    "</script",
    "<\\/script",
  );
}

function escapeMarkup(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function annotationMarkup(annotations: Annotation[] = []): string {
  const markers = annotations
    .filter(
      (annotation): annotation is Extract<Annotation, { type: "arrow" }> =>
        annotation.type === "arrow",
    )
    .map(
      (annotation) =>
        `<marker id="annotation-arrowhead-${escapeMarkup(annotation.id)}" markerWidth="0.05" markerHeight="0.05" refX="0.045" refY="0.025" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0.05,0.025 L0,0.05 Z" fill="${annotation.color}"/></marker>`,
    )
    .join("");
  const objects = annotations
    .map((annotation) => {
      const common = `class="annotation-object" data-annotation-id="${escapeMarkup(annotation.id)}" data-annotation-type="${annotation.type}"`;
      const rotation = annotation.rotation ?? 0;
      if (annotation.type === "circle") {
        return `<circle ${common} cx="${annotation.x}" cy="${annotation.y}" r="${annotation.radius}" fill="none" stroke="${annotation.color}" stroke-width="0.006" vector-effect="non-scaling-stroke" transform="rotate(${rotation} ${annotation.x} ${annotation.y})"/>`;
      }
      if (annotation.type === "rectangle") {
        const centerX = annotation.x + annotation.width / 2;
        const centerY = annotation.y + annotation.height / 2;
        return `<rect ${common} x="${annotation.x}" y="${annotation.y}" width="${annotation.width}" height="${annotation.height}" fill="none" stroke="${annotation.color}" stroke-width="0.006" vector-effect="non-scaling-stroke" transform="rotate(${rotation} ${centerX} ${centerY})"/>`;
      }
      if (annotation.type === "arrow") {
        const centerX = (annotation.x1 + annotation.x2) / 2;
        const centerY = (annotation.y1 + annotation.y2) / 2;
        return `<line ${common} x1="${annotation.x1}" y1="${annotation.y1}" x2="${annotation.x2}" y2="${annotation.y2}" stroke="${annotation.color}" stroke-width="0.006" marker-end="url(#annotation-arrowhead-${escapeMarkup(annotation.id)})" vector-effect="non-scaling-stroke" transform="rotate(${rotation} ${centerX} ${centerY})"/>`;
      }
      return `<text ${common} x="${annotation.x}" y="${annotation.y}" fill="${annotation.color}" font-size="${annotation.fontSize}" font-family="sans-serif" dominant-baseline="hanging" transform="rotate(${rotation} ${annotation.x} ${annotation.y})">${escapeMarkup(annotation.text)}</text>`;
    })
    .join("");
  return `<defs>${markers}</defs>${objects}`;
}

const template = Handlebars.compile(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{title}}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    :root { color: #17231d; background: #f3f6f1; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; }
    .document { max-width: 920px; margin: 0 auto; }
    .header { padding: 24px 0 20px; border-bottom: 2px solid #17231d; }
    h1 { margin: 0 0 8px; font-size: 30px; }
      .document-actions { display: flex; justify-content: flex-end; margin-top: 14px; }
      .document-actions button { border: 1px solid #167c55; border-radius: 4px; padding: 8px 12px; color: #fff; background: #167c55; font-weight: 700; cursor: pointer; }
      .document-actions button:disabled { cursor: wait; opacity: .65; }
    .source, .description, h2 { overflow-wrap: anywhere; word-break: break-word; }
    .source { color: #557064; }
    .step { break-inside: avoid; margin: 22px 0; padding: 18px; background: #fff; border: 1px solid #dce5dc; border-radius: 8px; }
    .step-header { display: flex; gap: 12px; align-items: baseline; }
    .number { color: #fff; background: #167c55; border-radius: 999px; min-width: 28px; height: 28px; display: inline-grid; place-items: center; font-weight: 700; }
    h2 { flex: 1; font-size: 19px; margin: 0; }
    .description { white-space: pre-wrap; color: #40564a; margin: 12px 0; }
    .screenshot-stage { position: relative; width: 100%; max-height: 420px; overflow: auto; background: #eef2ee; border: 1px solid #dce5dc; border-radius: 5px; }
    .screenshot-zoom-layer { position: relative; width: 100%; height: 100%; margin: 0 auto; }
    .screenshot { width: 100%; height: 100%; object-fit: contain; display: block; }
    .fabric-editor-stage { overflow: hidden; touch-action: none; }
    .fabric-editor-image, .fabric-editor-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .fabric-editor-image { object-fit: fill; }
    .fabric-editor-canvas { z-index: 1; }
    .annotation-overlay { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .annotation-overlay.editable { pointer-events: auto; touch-action: none; }
    .annotation-object { cursor: pointer; stroke-linecap: round; stroke-linejoin: round; }
    .annotation-overlay.editable .annotation-object { pointer-events: all; }
    .selection-handle { cursor: grab; pointer-events: all; }
    .selection-handle:active { cursor: grabbing; }
    .annotation-object.is-selected { filter: drop-shadow(0 0 0.008px #fff) drop-shadow(0 0 0.012px #167c55); }
    .annotation-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px; border: 1px solid #dce5dc; border-radius: 5px; background: #fff; }
    .annotation-tools button { min-width: 30px; min-height: 28px; border: 1px solid #c8d7ca; border-radius: 4px; padding: 4px 7px; color: #526657; background: #fff; font-size: 11px; font-weight: 700; cursor: pointer; }
    .annotation-tools button svg { width: 15px; height: 15px; display: block; margin: auto; }
    .annotation-tools button:hover, .annotation-tools button.active { border-color: #167c55; color: #167c55; background: #e4f3e7; }
    .annotation-tools button:disabled { cursor: not-allowed; opacity: .45; }
    .annotation-tools input[type="color"] { width: 28px; height: 28px; padding: 2px; border: 1px solid #c8d7ca; border-radius: 4px; background: #fff; cursor: pointer; }
    .annotation-range { display: inline-flex !important; align-items: center; gap: 4px !important; color: #526657 !important; font-size: 10px !important; }
    .annotation-range input { width: 70px !important; padding: 0 !important; }
    .annotation-tool-separator { width: 1px; height: 22px; background: #dce5dc; }
    .annotation-hint { color: #6b7d6d; font-size: 11px; }
    .annotation-text-input { position: absolute; z-index: 2; box-sizing: border-box; min-width: 120px; border: 1px solid #167c55; border-radius: 4px; padding: 5px 7px; color: #24382a; background: #fff; box-shadow: 0 2px 8px rgba(23, 35, 29, .16); font: inherit; outline: 2px solid rgba(22, 124, 85, .16); }
    .repeat-note { padding: 15px 16px; color: #557064; background: #f3f7f2; border: 1px dashed #c7d7c8; border-radius: 5px; font-size: 12px; }
    .unavailable { padding: 40px 16px; color: #7b6254; background: #fff7ed; text-align: center; }
    .edit-step { border: 1px solid #c8d7ca; border-radius: 4px; padding: 6px 9px; color: #167c55; background: #f4faf4; font-weight: 700; cursor: pointer; }
    .step-editor { display: grid; gap: 10px; margin: 14px 0; padding: 12px; border: 1px solid #dce5dc; border-radius: 5px; background: #f7faf6; }
    .step-editor[hidden] { display: none; }
    .step-editor label { display: grid; gap: 5px; color: #526657; font-size: 11px; font-weight: 700; }
    .step-editor input, .step-editor textarea { box-sizing: border-box; width: 100%; border: 1px solid #cbd8cc; border-radius: 4px; padding: 8px; color: #24382a; background: #fff; font: inherit; }
    .step-editor textarea { resize: vertical; }
    .editor-actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .editor-actions button { border: 1px solid #c8d7ca; border-radius: 4px; padding: 7px 9px; font-weight: 700; cursor: pointer; }
    .save-step { color: #fff; background: #167c55; }
    .cancel-step { color: #526657; background: #fff; }
    .remove-step { margin-left: auto; color: #a74d38; background: #fff8f5; border-color: #e3b9aa !important; }
    .preview-status { min-height: 1.2em; color: #557064; font-size: 12px; }
    @media print { .step { box-shadow: none; } }
  </style>
</head>
<body{{#if editable}} data-steps-api-url="{{stepsApiUrl}}"{{/if}}>
  <main class="document">
    <header class="header">
      <h1>{{title}}</h1>
      <div class="source">{{sourceUrl}}</div>
      {{#if editable}}<div class="document-actions"><button type="button" data-export-pdf>Export PDF</button></div>{{/if}}
      <body{{#if editable}} data-steps-api-url="{{stepsApiUrl}}" data-pdf-url="{{pdfUrl}}"{{/if}}>
    </header>
    {{#each steps}}
      <article class="step" data-step-id="{{id}}">
        <div class="step-header"><span class="number">{{displayNumber}}</span><h2 data-title>{{title}}</h2>{{#if ../editable}}<button class="edit-step" type="button" aria-label="Edit step {{displayNumber}}">Edit</button>{{/if}}</div>
        {{#if ../editable}}
          <div class="step-editor" data-editor hidden>
            <label>Title<input data-title-input value="{{title}}"></label>
            <label>Content<textarea data-description-input rows="4">{{description}}</textarea></label>
            {{#if imageSrc}}
              <div class="annotation-tools" data-annotation-tools role="toolbar" aria-label="Screenshot annotation tools">
                <button type="button" data-tool="select" class="active" aria-label="Select annotation" title="Select annotation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 3 5.8 15 2.1-6.1L19 9.8 5 3Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/><path d="m13.2 13.2 4.4 5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-tool="circle" aria-label="Draw circle" title="Draw circle"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
                <button type="button" data-tool="rectangle" aria-label="Draw rectangle" title="Draw rectangle"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
                <button type="button" data-tool="line" aria-label="Draw line" title="Draw line"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 14-14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-tool="arrow" aria-label="Draw arrow" title="Draw arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19 19 4m0 0h-7m7 0v7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-tool="text" aria-label="Add text" title="Add text"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M12 5v14m-4 0h8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-tool="pen" aria-label="Draw freehand" title="Draw freehand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 3.2-1 9.9-9.9a2.1 2.1 0 0 0-3-3L5.2 15l-.2 4Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-tool="highlighter" aria-label="Highlight" title="Highlight"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 16 8.8-8.8a2.1 2.1 0 0 1 3 3L8 19H5v-3Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/><path d="M4 21h16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-tool="redaction" aria-label="Redact area" title="Redact area"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1" fill="currentColor"/></svg></button>
                <span class="annotation-tool-separator"></span>
                <input type="color" data-color value="#ff7a45" aria-label="Annotation color">
                <input type="color" data-fill value="#ffffff" aria-label="Annotation fill">
                <label class="annotation-range">Opacity<input type="range" data-opacity min="0.1" max="1" step="0.1" value="1"></label>
                <label class="annotation-range">Stroke thickness<input type="range" data-stroke-width min="0.002" max="0.08" step="0.002" value="0.006"></label>
                <span class="annotation-tool-separator"></span>
                <button type="button" data-action="undo" aria-label="Undo" title="Undo" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-action="redo" aria-label="Redo" title="Redo" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-action="delete" aria-label="Delete selected annotation" title="Delete selected annotation" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14m-9 4v6m4-6v6M9 7l1-2h4l1 2m-8 0 1 13h8l1-13" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-action="duplicate" aria-label="Duplicate selected annotation" title="Duplicate selected annotation"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V5H5v11h3" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-action="bring-forward" aria-label="Bring annotation to front" title="Bring annotation to front"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 5 5m-5-5-5 5m5-5v12M5 20h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-action="send-backward" aria-label="Send annotation to back" title="Send annotation to back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 20-5-5m5 5 5-5m-5 5V8M5 4h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <button type="button" data-action="download" aria-label="Download annotated image" title="Download annotated image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
                <span class="annotation-hint">Click and drag on the image to draw.</span>
              </div>
            {{/if}}
            <div class="editor-actions">
              <button class="save-step" type="button">Save changes</button>
              <button class="cancel-step" type="button">Cancel</button>
              <button class="remove-step" type="button" aria-label="Remove step {{displayNumber}}">Remove step</button>
            </div>
          </div>
        {{/if}}
        {{#if description}}<p class="description" data-description>{{description}}</p>{{/if}}
        {{#if imageSrc}}{{#if ../editable}}<div class="screenshot-stage fabric-editor-stage" style="aspect-ratio: {{imageWidth}} / {{imageHeight}};" data-fabric-editor data-image-width="{{imageWidth}}" data-image-height="{{imageHeight}}"><img class="screenshot fabric-editor-image" src="{{imageSrc}}" alt="Screenshot for step {{displayNumber}}"><canvas class="fabric-editor-canvas" aria-label="Editable annotations for step {{displayNumber}}"></canvas><script type="application/json" data-editor-document>{{{editorDocumentJson}}}</script></div>{{else}}<div class="screenshot-stage" style="aspect-ratio: {{imageWidth}} / {{imageHeight}};"><div class="screenshot-zoom-layer"><img class="screenshot" src="{{imageSrc}}" alt="Screenshot for step {{displayNumber}}">{{#if editorOverlayMarkup}}{{{editorOverlayMarkup}}}{{else}}<svg class="annotation-overlay" data-overlay viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Annotations for step {{displayNumber}}">{{{annotationMarkup}}}</svg>{{/if}}</div></div>{{/if}}{{else}}{{#if repeatedFrom}}<div class="repeat-note">Same screenshot as step {{repeatedFrom}}</div>{{else}}<div class="unavailable">Image unavailable</div>{{/if}}{{/if}}
      </article>
    {{/each}}
  </main>
  {{#if editable}}
    <p class="preview-status" role="status" aria-live="polite"></p>
    <script type="application/json" id="project-data">{{{projectJson}}}</script>
    {{{fabricRuntime}}}
    {{{editorScript}}}
  {{/if}}
</body>
</html>`);

export interface RenderOptions {
  editable?: boolean;
  stepsApiUrl?: string;
  pdfUrl?: string;
}

export function renderHtml(
  project: Project,
  assetPrefix = "",
  options: RenderOptions = {},
): string {
  const parsedProject = projectSchema.parse(project);
  const assets = new Map(
    parsedProject.assets.map((asset) => [asset.id, asset]),
  );
  const seenImages = new Map<string, number>();
  const steps = [...parsedProject.steps]
    .sort((left, right) => left.order - right.order)
    .map((step, index) => {
      const asset = step.screenshotAssetId
        ? assets.get(step.screenshotAssetId)
        : undefined;
      const imageWidth = asset?.width ?? 16;
      const imageHeight = asset?.height ?? 9;
      const imagePath =
        asset?.status === "ready" && asset.relativePath
          ? asset.relativePath
          : undefined;
      const repeatedFrom = imagePath ? seenImages.get(imagePath) : undefined;
      if (imagePath && repeatedFrom === undefined)
        seenImages.set(imagePath, index + 1);
      return {
        ...step,
        displayNumber: index + 1,
        imageWidth,
        imageHeight,
        editorDocumentJson: JSON.stringify(
          step.editorDocument ??
            editorDocumentFromLegacyAnnotations(
              imageWidth,
              imageHeight,
              step.annotations,
            ),
        )
          .replaceAll("<", "\\u003c")
          .replaceAll(">", "\\u003e")
          .replaceAll("&", "\\u0026"),
        annotationMarkup: annotationMarkup(step.annotations),
        editorOverlayMarkup:
          !options.editable && step.editorDocument
            ? renderEditorSvg(step.editorDocument, {
                mode: "static",
                label: `Annotations for step ${index + 1}`,
              })
            : "",
        imageSrc:
          imagePath && repeatedFrom === undefined
            ? `${assetPrefix}${imagePath}`
            : undefined,
        repeatedFrom,
      };
    });

  const projectJson = JSON.stringify(parsedProject)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  return template({
    ...parsedProject,
    steps,
    editable: options.editable === true,
    stepsApiUrl: options.stepsApiUrl ?? "",
      pdfUrl: options.pdfUrl ?? "",
    fabricRuntime:
      options.editable === true
        ? `<script>${fabricBrowserBundle()}</script>${renderFabricEditorRuntime()}`
        : "",
    editorScript: options.editable === true ? renderEditableScript() : "",
    projectJson,
  });
}
