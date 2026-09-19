import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '../packages/domain/src/index.js';
import { createStorage } from '../packages/storage/src/index.js';
import { exportProjectImages } from '../apps/desktop/src/export.js';

const resources: Array<{ dataDir: string; close: () => void }> = [];

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async (resource) => {
      resource.close();
      await rm(resource.dataDir, { recursive: true, force: true });
    }),
  );
});

describe('desktop batch image export', () => {
  it('exports every ready asset to a folder with safe stable filenames', async () => {
    const { dataDir, storage, project } = await createFixture();
    const destination = path.join(dataDir, 'exports');

    const result = await exportProjectImages(storage, dataDir, {
      projectId: project.id,
      format: 'folder',
      destination,
    });

    expect(result.status).toBe('partial');
    expect(result.copied).toHaveLength(2);
    expect(result.skipped).toEqual([{ assetId: 'asset-missing', reason: 'Asset is not ready or has no path.' }]);
    const filenames = result.copied.map((item) => item.filename).sort();
    expect(filenames[0]).toMatch(/^01-Open-settings-asset-one\.png$/);
    expect(filenames[1]).toMatch(/^02-Open-settings-asset-two\.png$/);
    await expect(readFile(path.join(destination, filenames[0]!))).resolves.toEqual(Buffer.from('one'));
    await expect(readFile(path.join(destination, filenames[1]!))).resolves.toEqual(Buffer.from('two'));
  });

  it('exports ready assets to ZIP and leaves source files unchanged', async () => {
    const { dataDir, storage, project } = await createFixture();
    const destination = path.join(dataDir, 'exports', 'images.zip');
    const source = await readFile(path.join(dataDir, 'projects', project.id, 'assets', 'asset-one.png'));

    const result = await exportProjectImages(storage, dataDir, {
      projectId: project.id,
      format: 'zip',
      destination,
    });

    expect(result.copied).toHaveLength(2);
    expect((await readFile(destination)).subarray(0, 2).toString()).toBe('PK');
    await expect(readFile(path.join(dataDir, 'projects', project.id, 'assets', 'asset-one.png'))).resolves.toEqual(source);
  });

  it('uses an explicit overwrite policy when exporting repeatedly', async () => {
    const { dataDir, storage, project } = await createFixture();
    const destination = path.join(dataDir, 'exports');
    const first = await exportProjectImages(storage, dataDir, {
      projectId: project.id,
      format: 'folder',
      destination,
    });
    await writeFile(path.join(destination, first.copied[0]!.filename!), 'old export');

    const second = await exportProjectImages(storage, dataDir, {
      projectId: project.id,
      format: 'folder',
      destination,
    });

    expect(second.copied).toHaveLength(2);
    await expect(readFile(path.join(destination, first.copied[0]!.filename!))).resolves.toEqual(Buffer.from('one'));
  });

  it('reports missing files and rejects assets outside the data directory', async () => {
    const { dataDir, storage, project } = await createFixture();
    const outsidePath = path.join(path.dirname(dataDir), 'outside.png');
    await writeFile(outsidePath, 'outside');
    project.assets.push(
      {
        id: 'asset-outside',
        kind: 'original',
        status: 'ready',
        relativePath: '../outside.png',
        mimeType: 'image/png',
      },
      {
        id: 'asset-lost',
        kind: 'original',
        status: 'ready',
        relativePath: 'projects/project-export-test/assets/lost.png',
        mimeType: 'image/png',
      },
    );
    storage.projects.save(project);

    const result = await exportProjectImages(storage, dataDir, {
      projectId: project.id,
      format: 'folder',
      destination: path.join(dataDir, 'exports'),
    });
    await rm(outsidePath, { force: true });

    expect(result.copied).toHaveLength(2);
    expect(result.skipped).toContainEqual({
      assetId: 'asset-outside',
      reason: 'Asset path is outside the data directory.',
    });
    expect(result.skipped).toContainEqual({
      assetId: 'asset-lost',
      reason: 'Asset is not ready or has no path.',
    });
  });
});

async function createFixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-export-'));
  const storage = createStorage(dataDir);
  resources.push({ dataDir, close: () => storage.close() });
  const project: Project = {
    schemaVersion: 1,
    id: 'project-export-test',
    title: 'Export test',
    sourceUrl: 'https://example.com',
    status: 'completed',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    steps: [
      { id: 'step-1', order: 0, action: 'click', title: 'Open/settings', description: '', sourceEventIds: [], screenshotAssetId: 'asset-one' },
      { id: 'step-2', order: 1, action: 'click', title: 'Open/settings', description: '', sourceEventIds: [], screenshotAssetId: 'asset-two' },
    ],
    assets: [
      { id: 'asset-one', kind: 'original', status: 'ready', relativePath: 'projects/project-export-test/assets/asset-one.png', mimeType: 'image/png' },
      { id: 'asset-two', kind: 'original', status: 'ready', relativePath: 'projects/project-export-test/assets/asset-two.png', mimeType: 'image/png' },
      { id: 'asset-missing', kind: 'original', status: 'failed', error: 'capture failed' },
    ],
  };
  await storage.projects.save(project);
  await mkdir(path.join(dataDir, 'projects', project.id, 'assets'), { recursive: true });
  await writeFile(path.join(dataDir, 'projects', project.id, 'assets', 'asset-one.png'), 'one');
  await writeFile(path.join(dataDir, 'projects', project.id, 'assets', 'asset-two.png'), 'two');
  return { dataDir, storage, project };
}