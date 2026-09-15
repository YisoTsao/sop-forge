import { describe, expect, it } from 'vitest';
import { renderHtml } from '../packages/renderer/src/index.js';
import type { Project } from '../packages/domain/src/index.js';

const project: Project = {
  schemaVersion: 1,
  id: 'project-1',
  title: '<SOP title>',
  sourceUrl: 'https://example.com/?q=1&x=2',
  status: 'completed',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
  steps: [
    { id: 'step-2', order: 1, action: 'click', title: 'Second', description: '<script>alert(1)</script>', sourceEventIds: [], screenshotAssetId: 'asset-2' },
    { id: 'step-1', order: 0, action: 'navigation', title: 'First', description: 'Navigate', sourceEventIds: [], screenshotAssetId: 'asset-1' },
  ],
  assets: [
    { id: 'asset-1', kind: 'annotated', status: 'ready', relativePath: 'projects/project-1/assets/asset-1.png', mimeType: 'image/png' },
    { id: 'asset-2', kind: 'annotated', status: 'unavailable', mimeType: 'image/png' },
  ],
};

describe('SOP HTML renderer', () => {
  it('renders ordered steps and escapes captured text', () => {
    const html = renderHtml(project);

    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('projects/project-1/assets/asset-1.png');
    expect(html).toContain('Image unavailable');
    expect(html).toContain('overflow-wrap: anywhere');
  });

  it('collapses repeated screenshot assets after the first occurrence', () => {
    const repeatedProject: Project = {
      ...project,
      steps: project.steps.map((step) => ({ ...step, screenshotAssetId: 'asset-1' })),
      assets: [{ id: 'asset-1', kind: 'annotated', status: 'ready', relativePath: 'projects/project-1/assets/asset-1.png', mimeType: 'image/png' }],
    };
    const html = renderHtml(repeatedProject);

    expect((html.match(/class="screenshot"/g) ?? []).length).toBe(1);
    expect(html).toContain('Same screenshot as step 1');
  });

  it('renders an editable preview when requested', () => {
    const html = renderHtml(project, '/api/assets/', {
      editable: true,
      stepsApiUrl: '/api/projects/project-1/steps',
    });

    expect(html).toContain('Edit step 1');
    expect(html).toContain('Save changes');
    expect(html).toContain('Remove step 1');
    expect(html).toContain('/api/projects/project-1/steps');
  });

  it('renders persisted annotations and an inline annotation editor', () => {
    const annotatedProject: Project = {
      ...project,
      steps: [{
        ...project.steps[0]!,
        screenshotAssetId: 'asset-1',
        annotations: [
          { id: 'circle-1', type: 'circle', x: 0.25, y: 0.4, radius: 0.08, color: '#ff7a45' },
          { id: 'rectangle-1', type: 'rectangle', x: 0.1, y: 0.2, width: 0.4, height: 0.3, color: '#167c55' },
          { id: 'arrow-1', type: 'arrow', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.7, color: '#24382a' },
          { id: 'text-1', type: 'text', x: 0.3, y: 0.6, text: 'Click & save', color: '#24382a', fontSize: 0.04 },
        ],
      }],
      assets: [{ id: 'asset-1', kind: 'annotated', status: 'ready', relativePath: 'projects/project-1/assets/asset-1.png', mimeType: 'image/png', width: 1280, height: 720 }],
    };
    const html = renderHtml(annotatedProject, '/api/assets/', {
      editable: true,
      stepsApiUrl: '/api/projects/project-1/steps',
    });

    expect(html).toContain('data-annotation-type="circle"');
    expect(html).toContain('data-annotation-type="rectangle"');
    expect(html).toContain('data-annotation-type="arrow"');
    expect(html).toContain('Click &amp; save');
    expect(html).toContain('data-tool="circle"');
    expect(html).toContain('data-tool="rectangle"');
    expect(html).toContain('data-tool="arrow"');
    expect(html).toContain('data-tool="text"');
    expect(html).toContain('Zoom in');
    expect(html).toContain('Undo');
    expect(html).toContain('Redo');
    expect(html).toContain('Delete selected annotation');
  });

});
