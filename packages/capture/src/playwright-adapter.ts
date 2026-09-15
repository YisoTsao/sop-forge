import { randomUUID } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { validateRecordingUrl } from "./index.js";
import type { RawEvent, Target } from "../../domain/src/index.js";

interface ClientTarget {
  coordinates?: { x: number; y: number };
  target?: Target;
}

type ClientEvent =
  | ({ kind: "click"; timestamp: string } & ClientTarget)
  | ({
      kind: "input";
      timestamp: string;
      name?: string;
      inputType?: string;
      value: string;
      redacted: boolean;
    } & ClientTarget)
  | ({
      kind: "select";
      timestamp: string;
      name?: string;
      value: string;
    } & ClientTarget)
  | ({ kind: "keypress"; timestamp: string; key: string } & ClientTarget);

export interface BrowserSession {
  readonly sessionId: string;
  readonly page: Page;
  screenshot(): Promise<Buffer>;
  screenshotForEvent(eventId: string): Promise<Buffer | undefined>;
  onEvent(handler: (event: RawEvent) => void): () => void;
  onUnexpectedClose(handler: () => void): () => void;
  stop(): Promise<void>;
}

export interface LaunchOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  visualStabilityTimeoutMs?: number;
}

const instrumentation = String.raw`
(() => {
  const getRole = (element) => {
    if (element.getAttribute('role')) return element.getAttribute('role');
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') return 'textbox';
    return undefined;
  };
  const getName = (element) => {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (element.labels?.[0]?.textContent) return element.labels[0].textContent.trim();
    if (element.textContent) return element.textContent.trim().slice(0, 160);
    return element.getAttribute('value') || undefined;
  };
  const inspect = (element) => {
    const box = element.getBoundingClientRect();
    const id = element.id ? '#' + element.id : undefined;
    const name = element.getAttribute('name');
    const role = getRole(element);
    const accessibleName = getName(element);
    const locatorCandidates = [];
    if (id) locatorCandidates.push(id);
    if (role && accessibleName) locatorCandidates.push('role=' + role + '[name="' + accessibleName.replaceAll('"', '\\"') + '"]');
    if (name) locatorCandidates.push('[name="' + name.replaceAll('"', '\\"') + '"]');
    return {
      boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      tagName: element.tagName.toLowerCase(),
      role,
      accessibleName,
      visibleText: element.textContent?.trim().slice(0, 160),
      locatorCandidates,
      framePath: [],
      shadowDomPath: [],
    };
  };
  const clickableRoles = new Set(['button', 'link', 'checkbox', 'menuitem', 'option', 'radio', 'slider', 'spinbutton', 'switch', 'tab']);
  const isClickable = (element) => {
    const tag = element.tagName.toLowerCase();
    if (['a', 'button', 'summary'].includes(tag)) return true;
    if (clickableRoles.has(element.getAttribute('role'))) return true;
    if (element.hasAttribute('onclick')) return true;
    return element.tabIndex >= 0 && !['input', 'select', 'textarea'].includes(tag);
  };
  const findInteractive = (element) => {
    let current = element;
    while (current instanceof HTMLElement) {
      if (isClickable(current)) return current;
      current = current.parentElement;
    }
    return null;
  };
  const emit = (payload) => window.__sopForgeEmit(payload);
  let replayingClick = false;
  document.addEventListener('click', async (event) => {
    if (replayingClick) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const element = target ? findInteractive(target) : null;
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    await emit({ kind: 'click', timestamp: new Date().toISOString(), coordinates: { x: event.clientX, y: event.clientY }, target: inspect(element) });
    replayingClick = true;
    element.click();
    replayingClick = false;
  }, true);
  document.addEventListener('input', (event) => {
    const element = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!element) return;
    const redacted = element.type === 'password';
    emit({ kind: 'input', timestamp: new Date().toISOString(), name: element.name || undefined, inputType: element.type || undefined, value: redacted ? '[REDACTED]' : element.value, redacted, target: inspect(element) });
  }, true);
  document.addEventListener('change', (event) => {
    const element = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!element) return;
    emit({ kind: 'select', timestamp: new Date().toISOString(), name: element.name || undefined, value: element.value, target: inspect(element) });
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!['Enter', 'Tab', 'Escape'].includes(event.key)) return;
    const element = event.target instanceof HTMLElement ? event.target : null;
    emit({ kind: 'keypress', timestamp: new Date().toISOString(), key: event.key, target: element ? inspect(element) : undefined });
  }, true);
})();
`;

export class PlaywrightBrowserAdapter {
  constructor(private readonly defaults: LaunchOptions = {}) {}

  async launch(
    url: string,
    options: LaunchOptions = {},
  ): Promise<BrowserSession> {
    const normalizedUrl = validateRecordingUrl(url);
    const browser = await chromium.launch({
      headless: options.headless ?? this.defaults.headless ?? false,
    });
    const context = await browser.newContext({
      viewport: options.viewport ??
        this.defaults.viewport ?? { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    const handlers = new Set<(event: RawEvent) => void>();
    const closeHandlers = new Set<() => void>();
    const eventScreenshots = new Map<string, Buffer>();
    const sessionId = randomUUID();
    const visualStabilityTimeoutMs =
      options.visualStabilityTimeoutMs ??
      this.defaults.visualStabilityTimeoutMs ??
      2000;
    let sequence = 0;
    let intentionalStop = false;

    const emit = (event: RawEvent): void => {
      for (const handler of handlers) handler(event);
    };
    const emitClientEvent = async (payload: ClientEvent): Promise<void> => {
      const base = {
        id: randomUUID(),
        sessionId,
        sequence: sequence++,
        timestamp: payload.timestamp,
      };
      switch (payload.kind) {
        case "click": {
          const screenshot = await page
            .screenshot({ type: "png" })
            .catch(() => undefined);
          if (screenshot) eventScreenshots.set(base.id, screenshot);
          emit({
            ...base,
            type: "click",
            coordinates: payload.coordinates ?? { x: 0, y: 0 },
            target: payload.target,
          });
          break;
        }
        case "input":
          emit({
            ...base,
            type: "input",
            input: {
              name: payload.name,
              inputType: payload.inputType,
              value: payload.value,
              redacted: payload.redacted,
            },
            target: payload.target,
          });
          break;
        case "select":
          emit({
            ...base,
            type: "select",
            select: { name: payload.name, value: payload.value },
            target: payload.target,
          });
          break;
        case "keypress":
          emit({
            ...base,
            type: "keypress",
            key: payload.key,
            target: payload.target,
          });
          break;
      }
    };

    await page.exposeBinding(
      "__sopForgeEmit",
      async (_source, payload: ClientEvent) => emitClientEvent(payload),
    );
    await context.addInitScript({ content: instrumentation });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const timestamp = new Date().toISOString();
      emit({
        id: randomUUID(),
        sessionId,
        sequence: sequence++,
        timestamp,
        type: "navigation",
        navigation: { url: frame.url() },
      });
    });
    page.on("close", () => {
      if (!intentionalStop) for (const handler of closeHandlers) handler();
    });
    await page.goto(normalizedUrl, { waitUntil: "domcontentloaded" });

    return {
      sessionId,
      page,
      async screenshot() {
        const deadline = Date.now() + visualStabilityTimeoutMs;
        const remaining = () => Math.max(1, deadline - Date.now());
        await page
          .waitForLoadState("networkidle", { timeout: remaining() })
          .catch(() => undefined);
        await page
          .waitForFunction(
            () => Array.from(document.images).every((image) => image.complete),
            undefined,
            { timeout: remaining() },
          )
          .catch(() => undefined);
        await page
          .evaluate(async () => {
            if (document.fonts?.ready) await document.fonts.ready;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          })
          .catch(() => undefined);
        await page.waitForTimeout(Math.min(250, remaining()));
        return page.screenshot({ type: "png" });
      },
      async screenshotForEvent(eventId) {
        const screenshot = eventScreenshots.get(eventId);
        eventScreenshots.delete(eventId);
        return screenshot;
      },
      onEvent(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      onUnexpectedClose(handler) {
        closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      async stop() {
        intentionalStop = true;
        await context.close();
        await browser.close();
      },
    };
  }
}

export type { Browser, BrowserContext };
