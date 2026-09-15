import Handlebars from "handlebars";
import {
  projectSchema,
  type Annotation,
  type Project,
} from "../../domain/src/index.js";
import { renderEditableScript } from "./annotation-editor.js";

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
        `<marker id="annotation-arrowhead-${escapeMarkup(annotation.id)}" markerWidth="0.08" markerHeight="0.08" refX="0.07" refY="0.04" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0.08,0.04 L0,0.08 z" fill="${annotation.color}"/></marker>`,
    )
    .join("");
  const objects = annotations
    .map((annotation) => {
      const common = `class="annotation-object" data-annotation-id="${escapeMarkup(annotation.id)}" data-annotation-type="${annotation.type}"`;
      if (annotation.type === "circle") {
        return `<circle ${common} cx="${annotation.x}" cy="${annotation.y}" r="${annotation.radius}" fill="none" stroke="${annotation.color}" stroke-width="0.006" vector-effect="non-scaling-stroke"/>`;
      }
      if (annotation.type === "rectangle") {
        return `<rect ${common} x="${annotation.x}" y="${annotation.y}" width="${annotation.width}" height="${annotation.height}" fill="none" stroke="${annotation.color}" stroke-width="0.006" vector-effect="non-scaling-stroke"/>`;
      }
      if (annotation.type === "arrow") {
        return `<line ${common} x1="${annotation.x1}" y1="${annotation.y1}" x2="${annotation.x2}" y2="${annotation.y2}" stroke="${annotation.color}" stroke-width="0.006" marker-end="url(#annotation-arrowhead-${escapeMarkup(annotation.id)})" vector-effect="non-scaling-stroke"/>`;
      }
      return `<text ${common} x="${annotation.x}" y="${annotation.y}" fill="${annotation.color}" font-size="${annotation.fontSize}" font-family="sans-serif" dominant-baseline="hanging">${escapeMarkup(annotation.text)}</text>`;
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
    .annotation-overlay { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .annotation-overlay.editable { pointer-events: auto; touch-action: none; }
    .annotation-object { cursor: pointer; }
    .annotation-overlay.editable .annotation-object { pointer-events: all; }
    .annotation-object.is-selected { filter: drop-shadow(0 0 0.008px #fff) drop-shadow(0 0 0.012px #167c55); }
    .annotation-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px; border: 1px solid #dce5dc; border-radius: 5px; background: #fff; }
    .annotation-tools button { min-height: 28px; border: 1px solid #c8d7ca; border-radius: 4px; padding: 0 8px; color: #526657; background: #fff; font-size: 11px; font-weight: 700; cursor: pointer; }
    .annotation-tools button:hover, .annotation-tools button.active { border-color: #167c55; color: #167c55; background: #e4f3e7; }
    .annotation-tools button:disabled { cursor: not-allowed; opacity: .45; }
    .annotation-tools input[type="color"] { width: 28px; height: 28px; padding: 2px; border: 1px solid #c8d7ca; border-radius: 4px; background: #fff; cursor: pointer; }
    .annotation-tool-separator { width: 1px; height: 22px; background: #dce5dc; }
    .annotation-hint { color: #6b7d6d; font-size: 11px; }
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
                <button type="button" data-tool="select" class="active">Select</button>
                <button type="button" data-tool="circle">Circle</button>
                <button type="button" data-tool="rectangle">Rectangle</button>
                <button type="button" data-tool="arrow">Arrow</button>
                <button type="button" data-tool="text">Text</button>
                <span class="annotation-tool-separator"></span>
                <input type="color" data-color value="#ff7a45" aria-label="Annotation color">
                <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
                <button type="button" data-zoom="reset" aria-label="Reset zoom">100%</button>
                <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
                <span class="annotation-tool-separator"></span>
                <button type="button" data-action="undo" aria-label="Undo" disabled>Undo</button>
                <button type="button" data-action="redo" aria-label="Redo" disabled>Redo</button>
                <button type="button" data-action="delete" aria-label="Delete selected annotation" disabled>Delete</button>
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
        {{#if imageSrc}}<div class="screenshot-stage" style="aspect-ratio: {{imageWidth}} / {{imageHeight}};"><div class="screenshot-zoom-layer"><img class="screenshot" src="{{imageSrc}}" alt="Screenshot for step {{displayNumber}}"><svg class="annotation-overlay{{#if ../editable}} editable{{/if}}" data-overlay viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Annotations for step {{displayNumber}}">{{{annotationMarkup}}}</svg></div></div>{{else}}{{#if repeatedFrom}}<div class="repeat-note">Same screenshot as step {{repeatedFrom}}</div>{{else}}<div class="unavailable">Image unavailable</div>{{/if}}{{/if}}
      </article>
    {{/each}}
  </main>
  {{#if editable}}
    <p class="preview-status" role="status" aria-live="polite"></p>
    <script type="application/json" id="project-data">{{{projectJson}}}</script>
    {{{editorScript}}}
  {{/if}}
</body>
</html>`);

export interface RenderOptions {
  editable?: boolean;
  stepsApiUrl?: string;
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
        imageWidth: asset?.width ?? 16,
        imageHeight: asset?.height ?? 9,
        annotationMarkup: annotationMarkup(step.annotations),
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
    editorScript: options.editable === true ? renderEditableScript() : "",
    projectJson,
  });
}
