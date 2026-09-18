import { describe, expect, it } from 'vitest';
import {
  editorDocumentToFabricObjects,
  fabricObjectsToEditorDocument,
  legacyAnnotationsToEditorDocument,
} from '../packages/renderer/src/fabric-document-adapter.js';
import type { EditorDocument } from '../packages/domain/src/index.js';

const document: EditorDocument = {
  editorVersion: 1,
  source: { width: 1000, height: 500 },
  imageTransform: {
    crop: { x: 0, y: 0, width: 1, height: 1 },
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  objects: [
    {
      id: 'rectangle-1',
      type: 'rectangle',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.2,
      rotation: 12,
      style: {
        stroke: '#167c55',
        fill: '#ffffff',
        opacity: 0.8,
        strokeWidth: 0.01,
      },
    },
    {
      id: 'arrow-1',
      type: 'arrow',
      x1: 0.2,
      y1: 0.3,
      x2: 0.7,
      y2: 0.8,
      rotation: 0,
      style: { stroke: '#ff7a45', opacity: 1, strokeWidth: 0.008 },
      endHead: 'triangle',
    },
    {
      id: 'text-1',
      type: 'text',
      x: 0.4,
      y: 0.1,
      text: 'Click here',
      rotation: 0,
      style: {
        stroke: '#24382a',
        opacity: 1,
        strokeWidth: 0.004,
        fontSize: 0.05,
      },
    },
  ],
};

describe('Fabric document adapter', () => {
  it('maps editor objects to normalized Fabric descriptors', () => {
    const objects = editorDocumentToFabricObjects(document);

    expect(objects).toHaveLength(3);
    expect(objects[0]).toMatchObject({
      id: 'rectangle-1',
      type: 'rect',
      left: 100,
      top: 100,
      width: 300,
      height: 100,
      angle: 12,
    });
    expect(objects[1]).toMatchObject({
      id: 'arrow-1',
      type: 'arrow',
      x1: 200,
      y1: 150,
      x2: 700,
      y2: 400,
    });
  });

  it('serializes Fabric descriptors back to normalized editor objects', () => {
    const objects = editorDocumentToFabricObjects(document);
    const restored = fabricObjectsToEditorDocument(document, objects);

    expect(restored.objects).toEqual(document.objects);
  });

  it('migrates legacy annotations without dropping their geometry', () => {
    const migrated = legacyAnnotationsToEditorDocument(800, 600, [
      { id: 'circle-1', type: 'circle', x: 0.2, y: 0.3, radius: 0.1, color: '#ff7a45' },
      { id: 'text-1', type: 'text', x: 0.4, y: 0.5, text: 'Next', color: '#24382a', fontSize: 0.04 },
    ]);

    expect(migrated.source).toEqual({ width: 800, height: 600 });
    expect(migrated.objects).toMatchObject([
      { id: 'circle-1', type: 'circle', x: 0.2, y: 0.3, radius: 0.1 },
      { id: 'text-1', type: 'text', x: 0.4, y: 0.5, text: 'Next' },
    ]);
  });
});