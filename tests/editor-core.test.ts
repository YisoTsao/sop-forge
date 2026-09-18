import { describe, expect, it } from 'vitest';
import {
  editorDocumentSchema,
  stepSchema,
} from '../packages/domain/src/index.js';
import { renderEditorSvg } from '../packages/renderer/src/editor-svg.js';
import {
  applyCommand,
  createEditorHistory,
  createEditorDocument,
  getImageOutputSize,
  getObjectBounds,
  hitTest,
  editorDocumentFromLegacyAnnotations,
  clampCropRect,
  rotateImageTransform,
  setCropAspectRatio,
  normalizeEditorDocument,
  outputToSourcePoint,
  sourceToOutputPoint,
  redo,
  undo,
} from '../packages/renderer/src/editor-core.js';

describe('editor document contract', () => {
  it('accepts an editor document alongside legacy annotations', () => {
    const document = editorDocumentSchema.parse({
      editorVersion: 1,
      source: { width: 1200, height: 800 },
      imageTransform: {
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.6 },
        rotation: 90,
        flipX: false,
        flipY: true,
      },
      objects: [
        {
          id: 'rectangle-1',
          type: 'rectangle',
          x: 0.2,
          y: 0.25,
          width: 0.3,
          height: 0.2,
          rotation: 0,
          style: {
            stroke: '#167c55',
            opacity: 1,
            strokeWidth: 0.006,
          },
        },
      ],
    });

    const step = stepSchema.parse({
      id: 'step-1',
      order: 0,
      action: 'click',
      title: 'Click',
      description: '',
      sourceEventIds: [],
      annotations: [{
        id: 'circle-1',
        type: 'circle',
        x: 0.5,
        y: 0.5,
        radius: 0.05,
        color: '#ff7a45',
      }],
      editorDocument: document,
    });

    expect(step.editorDocument?.editorVersion).toBe(1);
    expect(step.annotations).toHaveLength(1);
  });

  it('rejects editor objects outside normalized bounds', () => {
    expect(() => editorDocumentSchema.parse({
      editorVersion: 1,
      source: { width: 1200, height: 800 },
      imageTransform: {
        crop: { x: 0, y: 0, width: 1, height: 1 },
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      objects: [{
        id: 'bad-rectangle',
        type: 'rectangle',
        x: 0.8,
        y: 0.2,
        width: 0.4,
        height: 0.2,
        rotation: 0,
        style: { stroke: '#167c55', opacity: 1, strokeWidth: 0.006 },
      }],
    })).toThrow();
  });
});

describe('editor geometry', () => {
  it('clamps crop rectangles and preserves requested aspect ratios', () => {
    const document = createEditorDocument(1600, 900);
    const crop = clampCropRect(
      { x: -0.1, y: 0.1, width: 1.2, height: 0.6 },
      { document, aspect: '16:9' },
    );
    const ratio = (crop.width * document.source.width) / (crop.height * document.source.height);

    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1);
    expect(ratio).toBeCloseTo(16 / 9, 6);
  });

  it('supports crop presets and quarter-turn image transforms', () => {
    const document = createEditorDocument(1600, 900);
    const square = setCropAspectRatio(document, '1:1');
    expect(square.imageTransform.crop.width * 1600).toBeCloseTo(square.imageTransform.crop.height * 900, 6);
    expect(rotateImageTransform(square.imageTransform, 'right').rotation).toBe(90);
    expect(rotateImageTransform({ ...square.imageTransform, rotation: 270 }, 'right').rotation).toBe(0);
  });

  it('migrates legacy annotations without changing their normalized geometry', () => {
    const document = editorDocumentFromLegacyAnnotations(800, 600, [
      { id: 'circle-1', type: 'circle', x: 0.2, y: 0.3, radius: 0.1, color: '#ff7a45' },
      { id: 'rectangle-1', type: 'rectangle', x: 0.1, y: 0.2, width: 0.3, height: 0.4, color: '#167c55', rotation: 15 },
      { id: 'arrow-1', type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.7, y2: 0.8, color: '#24382a' },
      { id: 'text-1', type: 'text', x: 0.4, y: 0.5, text: 'Next', color: '#24382a', fontSize: 0.04 },
    ]);

    expect(document.objects.map((object) => object.type)).toEqual([
      'circle', 'rectangle', 'arrow', 'text',
    ]);
    expect(document.objects[1]).toMatchObject({ x: 0.1, y: 0.2, width: 0.3, height: 0.4, rotation: 15 });
    expect(document.objects[3]).toMatchObject({ text: 'Next', style: { fontSize: 0.04 } });
  });

  it('normalizes crop bounds and computes rotated output dimensions', () => {
    const document = normalizeEditorDocument({
      ...createEditorDocument(1200, 800),
      imageTransform: {
        crop: { x: -0.1, y: 0.2, width: 0.8, height: 1.2 },
        rotation: 90,
        flipX: false,
        flipY: false,
      },
    });

    expect(document.imageTransform.crop).toEqual({
      x: 0,
      y: 0.2,
      width: 0.7,
      height: 0.8,
    });
    expect(getImageOutputSize(document)).toEqual({ width: 640, height: 840 });
  });

  it('converts points through crop, rotation and flips reversibly', () => {
    const document = normalizeEditorDocument({
      ...createEditorDocument(1000, 500),
      imageTransform: {
        crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
        rotation: 90,
        flipX: false,
        flipY: true,
      },
    });
    const outputPoint = sourceToOutputPoint(document, { x: 0.1, y: 0.2 });

    expect(outputPoint).toEqual({ x: 1, y: 1 });
    expect(outputToSourcePoint(document, outputPoint)).toEqual({ x: 0.1, y: 0.2 });
  });

  it('returns object bounds and the topmost hit', () => {
    const document = createEditorDocument(1000, 500, [
      {
        id: 'rectangle-1',
        type: 'rectangle',
        x: 0.2,
        y: 0.2,
        width: 0.4,
        height: 0.3,
        rotation: 0,
        style: { stroke: '#167c55', opacity: 1, strokeWidth: 0.006 },
      },
      {
        id: 'circle-1',
        type: 'circle',
        x: 0.4,
        y: 0.35,
        radius: 0.1,
        rotation: 0,
        style: { stroke: '#ff7a45', opacity: 1, strokeWidth: 0.006 },
      },
    ]);

    expect(getObjectBounds(document.objects[0]!)).toEqual({
      x: 0.2,
      y: 0.2,
      width: 0.4,
      height: 0.3,
    });
    expect(hitTest(document, { x: 0.4, y: 0.35 })).toBe('circle-1');
    expect(hitTest(document, { x: 0.25, y: 0.25 })).toBe('rectangle-1');
  });

  it('keeps immutable history and drops the redo branch after a new command', () => {
    const document = createEditorDocument(1000, 500, [{
      id: 'rectangle-1',
      type: 'rectangle',
      x: 0.2,
      y: 0.2,
      width: 0.4,
      height: 0.3,
      rotation: 0,
      style: { stroke: '#167c55', opacity: 1, strokeWidth: 0.006 },
    }]);
    const initial = createEditorHistory(document);
    const moved = applyCommand(initial, {
      type: 'move-object',
      id: 'rectangle-1',
      dx: 0.3,
      dy: 0.2,
    });
    const rectangleX = (history: typeof moved) => {
      const object = history.present.objects.find((candidate) => candidate.id === 'rectangle-1');
      if (!object || object.type !== 'rectangle') throw new Error('Rectangle fixture is missing.');
      return object.x;
    };

    expect(rectangleX(moved)).toBe(0.5);
    expect(rectangleX(undo(moved))).toBe(0.2);
    expect(rectangleX(redo(undo(moved)))).toBe(0.5);

    const styled = applyCommand(undo(moved), {
      type: 'set-object-style',
      ids: ['rectangle-1'],
      style: { opacity: 0.5 },
    });
    expect(styled.present.objects[0]?.style.opacity).toBe(0.5);
    expect(redo(styled)).toBe(styled);
  });

  it('renders a static SVG without editable-only controls', () => {
    const document = createEditorDocument(1000, 500, [{
      id: 'redaction-1',
      type: 'redaction',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
      mode: 'solid',
      rotation: 0,
      style: { stroke: '#17231d', fill: '#17231d', opacity: 1, strokeWidth: 0.006 },
    }, {
      id: 'text-1',
      type: 'text',
      x: 0.2,
      y: 0.4,
      text: '<secret>',
      rotation: 0,
      style: { stroke: '#167c55', opacity: 1, strokeWidth: 0.006 },
    }]);

    const markup = renderEditorSvg(document);
    expect(markup).toContain('editor-object-redaction');
    expect(markup).toContain('&lt;secret&gt;');
    expect(markup).not.toContain('tabindex');
  });
});
