import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlaywrightBrowserAdapter, type BrowserSession } from '../packages/capture/src/playwright-adapter.js';
import type { RawEvent } from '../packages/domain/src/index.js';

let server: Server;
let url: string;
let session: BrowserSession;

beforeEach(async () => {
  server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    if (request.url === '/next') {
      response.end('<h1>Next page</h1>');
      return;
    }
    response.end(`<!doctype html><button id="go" onclick="location.href='/next'">Go next</button><input id="email" name="email"><input id="password" name="password" type="password"><select id="role" name="role"><option value="admin">Admin</option></select>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not start');
  url = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await session?.stop();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('Playwright browser capture', () => {
  it('captures user actions and redacts password input', async () => {
    const adapter = new PlaywrightBrowserAdapter();
    session = await adapter.launch(url, { headless: true });
    const events: RawEvent[] = [];
    session.onEvent((event) => events.push(event));

    await session.page.mouse.click(900, 650);
    expect(events.some((event) => event.type === 'click')).toBe(false);
    await session.page.locator('#email').click();
    expect(events.some((event) => event.type === 'click')).toBe(false);

    await session.page.getByRole('button', { name: 'Go next' }).click();
    await session.page.goto(url);
    await session.page.locator('#email').fill('admin@example.com');
    await session.page.locator('#password').fill('secret');
    await session.page.locator('#role').selectOption('admin');
    await session.page.locator('#email').press('Enter');

    expect(events.some((event) => event.type === 'click')).toBe(true);
    const navigationClick = events.find((event) => event.type === 'click');
    expect(navigationClick).toBeDefined();
    expect(await session.screenshotForEvent(navigationClick!.id)).toBeInstanceOf(Buffer);
    expect(events.some((event) => event.type === 'navigation' && event.type === 'navigation' && event.navigation.url.endsWith('/next'))).toBe(true);
    expect(events.some((event) => event.type === 'input' && event.input.value === 'admin@example.com')).toBe(true);
    expect(events.some((event) => event.type === 'input' && event.input.redacted && event.input.value === '[REDACTED]')).toBe(true);
    expect(events.some((event) => event.type === 'select' && event.select.value === 'admin')).toBe(true);
    expect(events.some((event) => event.type === 'keypress' && event.key === 'Enter')).toBe(true);
    expect(new Set(events.map((event) => event.sessionId)).size).toBe(1);
  });

  it('notifies the manager when the browser page closes unexpectedly', async () => {
    const adapter = new PlaywrightBrowserAdapter();
    session = await adapter.launch(url, { headless: true });
    const closed = new Promise<void>((resolve) => session.onUnexpectedClose(resolve));

    await session.page.close();
    await closed;
  });

  it('waits for page images before taking a screenshot', async () => {
    await session?.stop();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server = createServer((request, response) => {
      response.setHeader('content-type', request.url === '/slow.png' ? 'image/png' : 'text/html');
      if (request.url === '/slow.png') {
        setTimeout(() => response.end(Buffer.from('not-a-real-image')), 150);
        return;
      }
      response.end('<!doctype html><img src="/slow.png" alt="slow">');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not start');
    session = await new PlaywrightBrowserAdapter().launch(`http://127.0.0.1:${address.port}`, { headless: true });

    await session.screenshot();

    expect(await session.page.locator('img').evaluate((image: HTMLImageElement) => image.complete)).toBe(true);
  });
});
