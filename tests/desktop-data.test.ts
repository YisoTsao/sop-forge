import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyData } from '../apps/desktop/src/data-paths.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('desktop data paths', () => {
  it('migrates legacy data into an empty destination and records a marker', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-migration-'));
    temporaryDirectories.push(root);
    const source = path.join(root, 'legacy');
    const destination = path.join(root, 'user-data', 'data');
    await writeFile(path.join(await createDirectory(source), 'sop-forge.db'), 'db');

    const result = await migrateLegacyData(source, destination);

    expect(result.status).toBe('migrated');
    await expect(readFile(path.join(destination, 'sop-forge.db'), 'utf8')).resolves.toBe('db');
    await expect(readFile(path.join(destination, '.sop-forge-migration.json'), 'utf8')).resolves.toContain('"version": 1');
  });

  it('does not overwrite an existing destination or source data', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-migration-'));
    temporaryDirectories.push(root);
    const source = path.join(root, 'legacy');
    const destination = path.join(root, 'user-data', 'data');
    await writeFile(path.join(await createDirectory(source), 'sop-forge.db'), 'legacy');
    await writeFile(path.join(await createDirectory(destination), 'sop-forge.db'), 'current');

    const result = await migrateLegacyData(source, destination);

    expect(result.status).toBe('skipped-non-empty');
    await expect(readFile(path.join(destination, 'sop-forge.db'), 'utf8')).resolves.toBe('current');
    await expect(readFile(path.join(source, 'sop-forge.db'), 'utf8')).resolves.toBe('legacy');
  });

  it('is idempotent after a successful migration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-migration-'));
    temporaryDirectories.push(root);
    const source = path.join(root, 'legacy');
    const destination = path.join(root, 'user-data', 'data');
    await writeFile(path.join(await createDirectory(source), 'sop-forge.db'), 'db');

    await migrateLegacyData(source, destination);
    const result = await migrateLegacyData(source, destination);

    expect(result.status).toBe('already-migrated');
  });
});

async function createDirectory(directory: string): Promise<string> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
  return directory;
}