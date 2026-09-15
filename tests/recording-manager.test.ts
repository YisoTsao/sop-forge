import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import type { RawEvent } from '../packages/domain/src/index.js';
import { createStorage } from '../packages/storage/src/index.js';
import { RecordingSessionManager, type BrowserAdapter } from '../packages/recording/src/index.js';
import type { BrowserSession } from '../packages/capture/src/playwright-adapter.js';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const managers: Array<{ manager: RecordingSessionManager; dataDir: string }> = [];

afterEach(async () => {
  for (const { manager, dataDir } of managers.splice(0)) {
    await manager.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

class FakeSession implements BrowserSession {
  readonly page = {} as Page;
  readonly sessionId = 'session-1';
  private eventHandlers = new Set<(event: RawEvent) => void>();
  private closeHandlers = new Set<() => void>();
  screenshotError = false;
  stopError = false;
  eventScreenshotCalls = 0;

  onEvent(handler: (event: RawEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onUnexpectedClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  emit(event: RawEvent): void {
    for (const handler of this.eventHandlers) handler(event);
  }

  async screenshot(): Promise<Buffer> {
    if (this.screenshotError) throw new Error('fixture screenshot failed');
    return pixel;
  }

  async screenshotForEvent(_eventId: string): Promise<Buffer | undefined> {
    this.eventScreenshotCalls += 1;
    return pixel;
  }

  async stop(): Promise<void> {
    if (this.stopError) throw new Error('fixture stop failed');
  }

  emitUnexpectedClose(): void {
    for (const handler of this.closeHandlers) handler();
  }
}

describe('recording session manager', () => {
  it('turns captured events into persisted steps and completes the project', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-manager-'));
    const storage = createStorage(dataDir);
    const fakeSession = new FakeSession();
    const adapter: BrowserAdapter = { launch: async () => fakeSession };
    const manager = new RecordingSessionManager({ storage, adapter });
    managers.push({ manager, dataDir });

    const recording = await manager.start('https://example.com');
    const messages: unknown[] = [];
    const unsubscribe = manager.subscribe(recording.sessionId, (message) => messages.push(message));
    fakeSession.emit({
      id: 'event-1', sessionId: fakeSession.sessionId, sequence: 0, timestamp: '2026-09-15T00:00:00.000Z', type: 'click',
      coordinates: { x: 10, y: 10 }, target: { locatorCandidates: [], framePath: [], shadowDomPath: [] },
    });
    await manager.flush(recording.sessionId);
    await manager.stop(recording.sessionId);
    unsubscribe();

    const project = storage.projects.load(recording.projectId);
    expect(project?.status).toBe('completed');
    expect(project?.steps[0]).toMatchObject({ action: 'click', screenshotAssetId: expect.any(String) });
    expect(fakeSession.eventScreenshotCalls).toBe(1);
    expect(project?.assets[0]).toMatchObject({ width: 1, height: 1 });
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'status', status: 'recording' }),
      expect.objectContaining({ type: 'event', event: expect.objectContaining({ id: 'event-1' }) }),
      expect.objectContaining({ type: 'asset', asset: expect.objectContaining({ status: 'ready' }) }),
      expect.objectContaining({ type: 'step', steps: expect.any(Array) }),
      expect.objectContaining({ type: 'status', status: 'stopping' }),
      expect.objectContaining({ type: 'status', status: 'completed' }),
    ]));
  });

  it('reuses identical screenshot assets across repeated events', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-manager-'));
    const storage = createStorage(dataDir);
    const fakeSession = new FakeSession();
    const manager = new RecordingSessionManager({ storage, adapter: { launch: async () => fakeSession } });
    managers.push({ manager, dataDir });

    const recording = await manager.start('https://example.com');
    for (const id of ['event-repeat-1', 'event-repeat-2']) {
      fakeSession.emit({
        id, sessionId: fakeSession.sessionId, sequence: id.endsWith('1') ? 0 : 1, timestamp: '2026-09-15T00:00:00.000Z', type: 'click',
        coordinates: { x: 10, y: 10 }, target: { locatorCandidates: [], framePath: [], shadowDomPath: [] },
      });
    }
    await manager.flush(recording.sessionId);

    const project = storage.projects.load(recording.projectId);
    expect(project?.steps).toHaveLength(2);
    expect(project?.assets).toHaveLength(2);
    expect(project?.steps[0]?.screenshotAssetId).toBe(project?.steps[1]?.screenshotAssetId);
  });

  it('preserves the step and marks the asset failed when screenshot capture fails', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-manager-'));
    const storage = createStorage(dataDir);
    const fakeSession = new FakeSession();
    fakeSession.screenshotError = true;
    const manager = new RecordingSessionManager({ storage, adapter: { launch: async () => fakeSession } });
    managers.push({ manager, dataDir });

    const recording = await manager.start('https://example.com');
    fakeSession.emit({
      id: 'event-failed-screenshot', sessionId: fakeSession.sessionId, sequence: 0, timestamp: '2026-09-15T00:00:00.000Z', type: 'click',
      coordinates: { x: 10, y: 10 }, target: { locatorCandidates: [], framePath: [], shadowDomPath: [] },
    });
    await manager.flush(recording.sessionId);

    const project = storage.projects.load(recording.projectId);
    expect(project?.steps).toHaveLength(1);
    expect(project?.steps[0]?.screenshotAssetId).toBeUndefined();
    expect(project?.assets).toContainEqual(expect.objectContaining({ status: 'failed', error: 'fixture screenshot failed' }));
  });

  it('persists the project as interrupted after an unexpected browser close', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-manager-'));
    const storage = createStorage(dataDir);
    const fakeSession = new FakeSession();
    const manager = new RecordingSessionManager({ storage, adapter: { launch: async () => fakeSession } });
    managers.push({ manager, dataDir });

    const recording = await manager.start('https://example.com');
    fakeSession.emitUnexpectedClose();
    await new Promise((resolve) => setImmediate(resolve));

    expect(storage.projects.load(recording.projectId)?.status).toBe('interrupted');
    expect(manager.getProject(recording.sessionId)).toBeNull();
  });

  it('persists a failed project when the browser cannot launch', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-manager-'));
    const storage = createStorage(dataDir);
    const manager = new RecordingSessionManager({
      storage,
      adapter: { launch: async () => { throw new Error('fixture launch failed'); } },
    });
    managers.push({ manager, dataDir });

    await expect(manager.start('https://example.com')).rejects.toThrow('fixture launch failed');
    expect(storage.projects.list()[0]).toMatchObject({ status: 'failed' });
  });

  it('marks the session failed when stopping the browser fails', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-manager-'));
    const storage = createStorage(dataDir);
    const fakeSession = new FakeSession();
    fakeSession.stopError = true;
    const manager = new RecordingSessionManager({ storage, adapter: { launch: async () => fakeSession } });
    managers.push({ manager, dataDir });

    const recording = await manager.start('https://example.com');
    await expect(manager.stop(recording.sessionId)).rejects.toThrow('fixture stop failed');
    expect(storage.projects.load(recording.projectId)?.status).toBe('failed');
    expect(manager.getProject(recording.sessionId)).toBeNull();
  });
});
