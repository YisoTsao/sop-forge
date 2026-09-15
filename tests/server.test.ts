import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import type { Project } from '../packages/domain/src/index.js';
import { createStorage } from '../packages/storage/src/index.js';
import { RecordingSessionManager } from '../packages/recording/src/index.js';
import type { BrowserAdapter } from '../packages/recording/src/index.js';
import type { BrowserSession } from '../packages/capture/src/playwright-adapter.js';

const resources: Array<{ app: Awaited<ReturnType<typeof buildApp>>; dataDir: string }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    await rm(resource.dataDir, { recursive: true, force: true });
  }
});

describe('local server API', () => {
  it('rejects unsupported recording URLs without launching a browser', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-api-'));
    const storage = createStorage(dataDir);
    const adapter: BrowserAdapter = { launch: async () => ({}) as BrowserSession };
    const manager = new RecordingSessionManager({ storage, adapter });
    const app = await buildApp({ manager, storage });
    resources.push({ app, dataDir });

    const response = await app.inject({ method: 'POST', url: '/api/sessions', payload: { url: 'file:///tmp/test.html' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining('HTTP or HTTPS') });
  });

  it('rejects malformed step edits using the shared project schema', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-api-'));
    const storage = createStorage(dataDir);
    const adapter: BrowserAdapter = { launch: async () => ({}) as BrowserSession };
    const manager = new RecordingSessionManager({ storage, adapter });
    const app = await buildApp({ manager, storage });
    resources.push({ app, dataDir });
    const project: Project = {
      schemaVersion: 1,
      id: 'project-schema-test',
      title: 'Schema test',
      sourceUrl: 'https://example.com',
      status: 'completed',
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
      steps: [],
      assets: [],
    };
    storage.projects.save(project);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/steps`,
      payload: { steps: [{ id: 'step-1', order: 0, action: 'click' }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('serves the project preview in editable mode', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-api-'));
    const storage = createStorage(dataDir);
    const adapter: BrowserAdapter = { launch: async () => ({}) as BrowserSession };
    const manager = new RecordingSessionManager({ storage, adapter });
    const app = await buildApp({ manager, storage });
    resources.push({ app, dataDir });
    const project: Project = {
      schemaVersion: 1,
      id: 'project-preview-test',
      title: 'Preview test',
      sourceUrl: 'https://example.com',
      status: 'completed',
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
      steps: [{ id: 'step-1', order: 0, action: 'click', title: 'Click', description: 'Content', sourceEventIds: [] }],
      assets: [],
    };
    storage.projects.save(project);

    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/preview` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Edit step 1');
  });
});
