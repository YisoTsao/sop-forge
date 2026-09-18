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

  it('renders a read-only live preview with standalone edit and PDF actions', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/sessions') return Promise.resolve(response({ sessionId: 'session-ui-test', projectId: project.id }));
      if (url === `/api/projects/${project.id}`) return Promise.resolve(response(project));
      if (options?.method === 'PATCH') return Promise.resolve(response(project));
      return Promise.resolve(response({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
    expect(await screen.findByText('LIVE PREVIEW')).toBeTruthy();
    expect(await screen.findByAltText('Preview screenshot for step 1')).toBeTruthy();
    const editLink = screen.getByRole('link', { name: 'Preview/edit HTML ↗' });
    expect(editLink.getAttribute('href')).toBe(`/api/projects/${project.id}/edit`);
    expect(screen.getByRole('button', { name: 'Export PDF ↓' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit step 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save step edits' })).toBeNull();
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
    const previewLink = await screen.findByRole('link', { name: 'Preview/edit HTML ↗' });
    expect(screen.queryByRole('button', { name: 'Stop and save session' })).toBeNull();
    expect(previewLink.getAttribute('href')).toBe(`/api/projects/${project.id}/edit`);
  });
});
