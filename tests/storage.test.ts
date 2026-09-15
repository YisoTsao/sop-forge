import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorage } from '../packages/storage/src/index.js';
import type { Project } from '../packages/domain/src/index.js';

const projects: Array<ReturnType<typeof createStorage>> = [];

const project: Project = {
  schemaVersion: 1,
  id: 'project-1',
  title: 'Storage test',
  sourceUrl: 'https://example.com',
  status: 'completed',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
  steps: [
    {
      id: 'step-1',
      order: 0,
      action: 'click',
      title: 'Original title',
      description: 'Description',
      sourceEventIds: ['event-1'],
      screenshotAssetId: 'asset-1',
    },
  ],
  assets: [],
};

afterEach(async () => {
  for (const storage of projects.splice(0)) {
    storage.close();
    await rm(storage.dataDir, { recursive: true, force: true });
  }
});

describe('local recording storage', () => {
  it('persists and reloads edited project steps', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-storage-'));
    const storage = createStorage(dataDir);
    projects.push(storage);

    storage.projects.save({ ...project, steps: [{ ...project.steps[0]!, title: 'Edited title', order: 1 }] });

    const loaded = storage.projects.load(project.id);
    expect(loaded?.steps[0]?.title).toBe('Edited title');
    expect(loaded?.steps[0]?.order).toBe(1);
  });

  it('writes assets atomically before returning metadata', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-storage-'));
    const storage = createStorage(dataDir);
    projects.push(storage);
    storage.projects.save(project);

    const asset = await storage.assets.write({
      projectId: project.id,
      assetId: 'asset-1',
      kind: 'original',
      mimeType: 'text/plain',
      contents: Buffer.from('asset content'),
    });

    expect(asset.status).toBe('ready');
    expect(await readFile(path.join(dataDir, asset.relativePath!))).toEqual(Buffer.from('asset content'));
  });

  it('marks a missing asset unavailable when loading a project', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-storage-'));
    const storage = createStorage(dataDir);
    projects.push(storage);

    storage.projects.save({
      ...project,
      assets: [{ id: 'asset-1', kind: 'original', status: 'ready', relativePath: 'projects/project-1/assets/missing.png', mimeType: 'image/png' }],
    });

    const loaded = storage.projects.load(project.id);
    expect(loaded?.assets[0]?.status).toBe('unavailable');
  });
});
