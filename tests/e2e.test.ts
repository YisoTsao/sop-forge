import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlaywrightBrowserAdapter, type BrowserSession } from '../packages/capture/src/playwright-adapter.js';
import { RecordingSessionManager, type BrowserAdapter } from '../packages/recording/src/index.js';
import { createStorage } from '../packages/storage/src/index.js';
import { renderHtml } from '../packages/renderer/src/index.js';
import { exportPdf } from '../packages/renderer/src/pdf.js';

const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'recording-fixture.html');
const resources: Array<{ manager: RecordingSessionManager; storage: ReturnType<typeof createStorage>; server: Server; dataDir: string }> = [];

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Fixture server did not expose a port.'));
      resolve(address.port);
    });
  });
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.manager.close();
    resource.storage.close();
    await new Promise<void>((resolve, reject) => resource.server.close((error) => error ? reject(error) : resolve()));
  }
});

describe('recording workflow', () => {
  it('records user actions, reloads the project, renders HTML, and exports PDF', async () => {
    const fixture = await readFile(fixturePath, 'utf8');
    const server = createServer((request, response) => {
      if (request.url === '/next') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><html><body><h1>Next page</h1></body></html>');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(fixture);
    });
    const port = await listen(server);
    const dataDir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), 'sop-forge-e2e-')));
    const storage = createStorage(dataDir);
    const playwrightAdapter = new PlaywrightBrowserAdapter({ headless: true, viewport: { width: 1024, height: 768 } });
    let browserSession: BrowserSession | undefined;
    const adapter: BrowserAdapter = {
      launch: async (url) => {
        browserSession = await playwrightAdapter.launch(url);
        return browserSession;
      },
    };
    const manager = new RecordingSessionManager({ storage, adapter });
    resources.push({ manager, storage, server, dataDir });

    const recording = await manager.start(`http://127.0.0.1:${port}/index.html`);
    const page = browserSession?.page;
    if (!page) throw new Error('Recording browser did not launch.');
    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByLabel('Name').fill('Ada');
    await page.getByLabel('Mode').selectOption('guided');
    await page.getByLabel('Password').fill('secret-value');
    await page.getByLabel('Name').press('Enter');
    await page.getByRole('link', { name: 'Next page' }).click();
    await page.waitForLoadState('domcontentloaded');
    await manager.stop(recording.sessionId);

    const project = storage.projects.load(recording.projectId);
    const rawEvents = storage.events.list(recording.sessionId);
    expect(project?.status).toBe('completed');
    expect(project?.steps.map((step) => step.action)).toEqual(expect.arrayContaining(['click', 'input', 'select', 'keypress', 'navigation']));
    expect(rawEvents.some((event) => event.type === 'input' && event.input.redacted && event.input.value === '[REDACTED]')).toBe(true);
    expect(JSON.stringify(rawEvents)).not.toContain('secret-value');
    expect(project?.assets.some((asset) => asset.status === 'ready')).toBe(true);

    if (!project) throw new Error('Project was not persisted.');
    const html = renderHtml(project);
    expect(html).toContain(`SOP for 127.0.0.1`);
    expect(html).toContain('Click &quot;Reveal&quot;');
    expect(html).toContain(project.sourceUrl);
    expect(html).toContain('data-step-id=');
    const pdfPath = path.join(dataDir, 'projects', project.id, 'sop.pdf');
    await exportPdf(html, pdfPath, `file://${dataDir}/`);
    expect((await stat(pdfPath)).size).toBeGreaterThan(0);
  });
});
