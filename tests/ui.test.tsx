// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../packages/domain/src/index.js';
import { App } from '../apps/web/src/main.js';

const project: Project = {
  schemaVersion: 1,
  id: 'project-ui-test',
  title: 'UI test project',
  sourceUrl: 'https://example.com',
  status: 'completed',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
  steps: [
    { id: 'step-1', order: 0, action: 'click', title: 'First step', description: 'Click first', sourceEventIds: [], screenshotAssetId: 'asset-ui-1' },
    { id: 'step-2', order: 1, action: 'input', title: 'Second step', description: 'Enter second', sourceEventIds: [] },
  ],
  assets: [{ id: 'asset-ui-1', kind: 'annotated', status: 'ready', relativePath: 'projects/project-ui-test/assets/asset-ui-1.png', mimeType: 'image/png' }],
};

class FakeWebSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close(): void {}
}

function response(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => payload } as Response;
}

describe('recording workspace UI', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  it('shows a readable error when the starting URL is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'Please enter a valid URL.' }, false)));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Please enter a valid URL.');
  });

  it('renders, edits, reorders, deletes, and saves captured steps', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/sessions') return Promise.resolve(response({ sessionId: 'session-ui-test', projectId: project.id }));
      if (url === `/api/projects/${project.id}`) return Promise.resolve(response(project));
      if (options?.method === 'PATCH') return Promise.resolve(response(project));
      return Promise.resolve(response({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
    expect(await screen.findByDisplayValue('First step')).toBeTruthy();
    expect(await screen.findByAltText('Screenshot for step 1')).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue('First step'), { target: { value: 'Edited first step' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save step edits' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${project.id}/steps`, expect.objectContaining({ method: 'PATCH' })));

    const moveDown = screen.getAllByRole('button', { name: 'Move step down' }).find((button) => !button.hasAttribute('disabled'));
    if (!moveDown) throw new Error('Expected a movable step.');
    fireEvent.click(moveDown);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete step' })[0]!);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, options]) => (options as RequestInit | undefined)?.method === 'PATCH').length).toBeGreaterThanOrEqual(3));
  });

  it('opens preview step editing and removes the selected item', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/sessions') return Promise.resolve(response({ sessionId: 'session-ui-test', projectId: project.id }));
      if (url === `/api/projects/${project.id}`) return Promise.resolve(response(project));
      if (options?.method === 'PATCH') return Promise.resolve(response(project));
      return Promise.resolve(response({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
    expect(await screen.findByRole('button', { name: 'Edit step 1' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit step 1' }));
    const previewTitle = screen.getByRole('textbox', { name: 'Preview step 1 title' });
    const previewContent = screen.getByRole('textbox', { name: 'Preview step 1 content' });
    expect(previewTitle).toBeTruthy();
    expect(previewContent).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove preview step 1' })).toBeTruthy();

    fireEvent.change(previewTitle, { target: { value: 'Updated preview title' } });
    fireEvent.change(previewContent, { target: { value: 'Updated preview content' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => (options as RequestInit | undefined)?.method === 'PATCH');
      expect(patch?.[1] && JSON.parse((patch[1] as RequestInit).body as string)).toMatchObject({
        steps: expect.arrayContaining([
          expect.objectContaining({ title: 'Updated preview title', description: 'Updated preview content' }),
        ]),
      });
    });

    vi.stubGlobal('confirm', vi.fn(() => true));
    fireEvent.click(screen.getByRole('button', { name: 'Edit step 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove preview step 1' }));
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, options]) => (options as RequestInit | undefined)?.method === 'PATCH');
      const lastPayload = JSON.parse(patches.at(-1)?.[1]?.body as string);
      expect(lastPayload.steps).toHaveLength(1);
    });
  });

  it('stops recording without sending an empty JSON body and keeps preview available', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/sessions') return Promise.resolve(response({ sessionId: 'session-ui-test', projectId: project.id }));
      if (url === `/api/projects/${project.id}`) return Promise.resolve(response(project));
      if (url === `/api/sessions/session-ui-test/stop`) return Promise.resolve(response(project));
      return Promise.resolve(response({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
    await screen.findByRole('button', { name: 'Stop and save session' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop and save session' }));

    await waitFor(() => {
      const stopCall = fetchMock.mock.calls.find(([url]) => url === '/api/sessions/session-ui-test/stop');
      expect(stopCall?.[1]).toMatchObject({ method: 'POST' });
      expect((stopCall?.[1] as RequestInit).headers).not.toHaveProperty('content-type');
      expect((stopCall?.[1] as RequestInit).body).toBeUndefined();
    });
    const previewLink = await screen.findByRole('link', { name: 'Preview HTML ↗' });
    expect(screen.queryByRole('button', { name: 'Stop and save session' })).toBeNull();
    expect(previewLink).toHaveAttribute(
      'href',
      `/api/projects/${project.id}/preview`,
    );
  });
});
