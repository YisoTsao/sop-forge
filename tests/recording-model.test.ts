import { describe, expect, it } from 'vitest';
import { normalizeRawEvents, validateRecordingUrl } from '../packages/capture/src/index.js';
import type { RawEvent } from '../packages/domain/src/index.js';

const base = { sessionId: 'session-1', timestamp: '2026-09-15T00:00:00.000Z' };

describe('recording model helpers', () => {
  it('accepts only HTTP and HTTPS recording URLs', () => {
    expect(validateRecordingUrl('https://example.com')).toBe('https://example.com/');
    expect(validateRecordingUrl('http://localhost:3000/form')).toBe('http://localhost:3000/form');
    expect(() => validateRecordingUrl('file:///tmp/page.html')).toThrow(/HTTP or HTTPS/);
    expect(() => validateRecordingUrl('not a url')).toThrow(/valid URL/);
  });

  it('deduplicates events and creates stable click and input steps', () => {
    const events: RawEvent[] = [
      {
        ...base,
        id: 'event-click',
        sequence: 0,
        type: 'click',
        coordinates: { x: 100, y: 200 },
        target: { locatorCandidates: ['role=button'], framePath: [], shadowDomPath: [] },
      },
      {
        ...base,
        id: 'event-input-1',
        sequence: 1,
        type: 'input',
        input: { name: 'email', inputType: 'email', value: 'a@example.com', redacted: false },
      },
      {
        ...base,
        id: 'event-input-2',
        sequence: 2,
        type: 'input',
        input: { name: 'email', inputType: 'email', value: 'admin@example.com', redacted: false },
      },
      {
        ...base,
        id: 'event-click',
        sequence: 3,
        type: 'click',
        coordinates: { x: 100, y: 200 },
      },
      { ...base, id: 'event-unknown', sequence: 4, type: 'unsupported', detail: 'drag' },
    ];

    const steps = normalizeRawEvents(events, new Map([['event-click', 'asset-click']]));

    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ id: 'step-event-click', action: 'click', screenshotAssetId: 'asset-click' });
    expect(steps[1]).toMatchObject({ action: 'input', description: 'admin@example.com', sourceEventIds: ['event-input-1', 'event-input-2'] });
    expect(steps[2]).toMatchObject({ action: 'unsupported', sourceEventIds: ['event-unknown'] });
  });

  it('keeps password input redacted in normalized steps', () => {
    const event: RawEvent = {
      ...base,
      id: 'event-password',
      sequence: 0,
      type: 'input',
      input: { name: 'password', inputType: 'password', value: '[REDACTED]', redacted: true },
    };

    const [step] = normalizeRawEvents([event], new Map());
    expect(step?.description).toBe('[REDACTED]');
  });

  it('collapses consecutive navigation events for the same URL', () => {
    const events: RawEvent[] = [
      {
        ...base,
        id: 'event-navigation-1',
        sequence: 0,
        type: 'navigation',
        navigation: { url: 'https://example.com/dashboard' },
      },
      {
        ...base,
        id: 'event-navigation-2',
        sequence: 1,
        type: 'navigation',
        navigation: { url: 'https://example.com/dashboard' },
      },
      {
        ...base,
        id: 'event-navigation-3',
        sequence: 2,
        type: 'navigation',
        navigation: { url: 'https://example.com/dashboard' },
      },
    ];

    const steps = normalizeRawEvents(events, new Map());

    expect(steps).toHaveLength(1);
    expect(steps[0]?.sourceEventIds).toEqual(['event-navigation-1']);
  });

  it('collapses consecutive navigation events with the same screenshot', () => {
    const events: RawEvent[] = [
      {
        ...base,
        id: 'event-navigation-1',
        sequence: 0,
        type: 'navigation',
        navigation: { url: 'https://payment.example.com/redirect' },
      },
      {
        ...base,
        id: 'event-navigation-2',
        sequence: 1,
        type: 'navigation',
        navigation: { url: 'https://app.example.com/result' },
      },
    ];

    const steps = normalizeRawEvents(
      events,
      new Map([
        ['event-navigation-1', 'asset-same'],
        ['event-navigation-2', 'asset-same'],
      ]),
    );

    expect(steps).toHaveLength(1);
    expect(steps[0]?.sourceEventIds).toEqual(['event-navigation-1']);
  });
});
