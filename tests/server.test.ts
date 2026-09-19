import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { startLocalServer } from '../apps/server/src/server.js';
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
  it('starts a reusable loopback server on an ephemeral port', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-runtime-'));
    const runtime = await startLocalServer({
      dataDir,
      host: '127.0.0.1',
      port: 0,
      adapter: { launch: async () => ({}) as BrowserSession },
    });
    try {
      expect(runtime.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const healthResponse = await fetch(`${runtime.url}/api/health`);
      expect(healthResponse.status).toBe(200);
      expect(await healthResponse.json()).toEqual({ status: 'ok' });

      const project: Project = {
        schemaVersion: 1,
        id: 'project-runtime-test',
        title: 'Runtime test',
        sourceUrl: 'https://example.com',
        status: 'completed',
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
        steps: [],
        assets: [],
      };
      runtime.storage.projects.save(project);
      const projectResponse = await fetch(
        `${runtime.url}/api/projects/${project.id}`,
      );
      expect(projectResponse.status).toBe(200);
      expect(await projectResponse.json()).toMatchObject({ id: project.id });

      await runtime.storage.assets.write({
        projectId: project.id,
        assetId: 'asset-runtime-test',
        kind: 'original',
        mimeType: 'image/png',
        contents: Buffer.from('test-image'),
      });
      const assetResponse = await fetch(
        `${runtime.url}/api/assets/projects/${project.id}/assets/asset-runtime-test.png`,
      );
      expect(assetResponse.status).toBe(200);
    } finally {
      await runtime.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

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

  it('serves separate read-only preview and editable HTML routes', async () => {
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
    expect(response.body).not.toContain('Edit step 1');

    const editResponse = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/edit` });
    expect(editResponse.statusCode).toBe(200);
    expect(editResponse.body).toContain('Edit step 1');
    expect(editResponse.body).toContain('data-export-pdf');
    expect(editResponse.body).toContain(`/api/projects/${project.id}/pdf`);
  });
});
