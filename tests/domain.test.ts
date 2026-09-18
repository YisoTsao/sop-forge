import { describe, expect, it } from 'vitest';
import {
  assetSchema,
  projectSchema,
  rawEventSchema,
  stepSchema,
} from '../packages/domain/src/index.js';

describe('domain contracts', () => {
  it('accepts a versioned project with ordered steps and assets', () => {
    const project = projectSchema.parse({
      schemaVersion: 1,
      id: 'project-1',
      title: 'Login flow',
      sourceUrl: 'https://example.com/login',
      status: 'completed',
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
      steps: [
        {
          id: 'step-1',
          order: 0,
          action: 'click',
          title: 'Click sign in',
          description: 'Click the sign in button.',
          sourceEventIds: ['event-1'],
          target: {
            coordinates: { x: 120, y: 80 },
            boundingBox: { x: 100, y: 60, width: 80, height: 40 },
            tagName: 'button',
            role: 'button',
            accessibleName: 'Sign in',
            locatorCandidates: ['role=button[name="Sign in"]'],
            framePath: [],
            shadowDomPath: [],
          },
          screenshotAssetId: 'asset-1',
        },
      ],
      assets: [
        {
          id: 'asset-1',
          kind: 'annotated',
          status: 'ready',
          relativePath: 'assets/asset-1.png',
          mimeType: 'image/png',
          width: 1280,
          height: 720,
        },
      ],
    });

    expect(project.steps[0]?.id).toBe('step-1');
  });

  it('rejects unsupported project schema versions', () => {
    expect(() =>
      projectSchema.parse({
        schemaVersion: 2,
        id: 'project-1',
        title: 'Invalid',
        sourceUrl: 'https://example.com',
        status: 'completed',
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
        steps: [],
        assets: [],
      }),
    ).toThrow();
  });

  it('requires redaction metadata for password input events', () => {
    const event = rawEventSchema.parse({
      id: 'event-1',
      sessionId: 'session-1',
      sequence: 0,
      type: 'input',
      timestamp: '2026-09-15T00:00:00.000Z',
      input: {
        name: 'password',
        inputType: 'password',
        value: '[REDACTED]',
        redacted: true,
      },
    });

    expect(event.type).toBe('input');
    if (event.type === 'input') expect(event.input.redacted).toBe(true);
  });

  it('rejects incomplete assets and steps', () => {
    expect(() => assetSchema.parse({ id: 'asset-1', kind: 'original' })).toThrow();
    expect(() => stepSchema.parse({ id: 'step-1', order: 0, action: 'click' })).toThrow();
  });

  it('accepts persisted screenshot annotations on a step', () => {
    const step = stepSchema.parse({
      id: 'step-annotated',
      order: 0,
      action: 'click',
      title: 'Click sign in',
      description: 'Click the sign in button.',
      sourceEventIds: ['event-1'],
      annotations: [
        { id: 'circle-1', type: 'circle', x: 0.25, y: 0.4, radius: 0.08, color: '#ff7a45' },
        { id: 'rectangle-1', type: 'rectangle', x: 0.1, y: 0.2, width: 0.4, height: 0.3, rotation: 28, color: '#167c55' },
        { id: 'arrow-1', type: 'arrow', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.7, color: '#24382a' },
        { id: 'text-1', type: 'text', x: 0.3, y: 0.6, text: 'Click here', color: '#24382a', fontSize: 0.04 },
      ],
    });

    expect(step.annotations).toHaveLength(4);
    expect(step.annotations?.find((annotation) => annotation.id === 'rectangle-1')?.rotation).toBe(28);
  });
});
