import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  validateRecordingUrl,
  normalizeRawEvents,
} from "../../capture/src/index.js";
import type { BrowserSession } from "../../capture/src/playwright-adapter.js";
import type {
  Asset,
  Project,
  RawEvent,
  SessionStatus,
} from "../../domain/src/index.js";
import { annotateScreenshot } from "../../screenshot/src/index.js";
import type { Storage } from "../../storage/src/index.js";

export interface BrowserAdapter {
  launch(url: string): Promise<BrowserSession>;
}

interface ActiveRecording {
  project: Project;
  session: BrowserSession;
  rawEvents: RawEvent[];
  screenshotAssets: Map<string, string>;
  originalAssetsByHash: Map<string, Asset>;
  annotatedAssetsByHash: Map<string, Asset>;
  pending: Set<Promise<void>>;
  removeEventHandler: () => void;
  removeCloseHandler: () => void;
  subscribers: Set<(message: unknown) => void>;
}

function now(): string {
  return new Date().toISOString();
}

function screenshotGeometry(event: RawEvent) {
  if (event.type === "click")
    return {
      coordinates: event.coordinates,
      boundingBox: event.target?.boundingBox,
    };
  if (
    event.type === "input" ||
    event.type === "select" ||
    event.type === "keypress"
  ) {
    return { boundingBox: event.target?.boundingBox };
  }
  return {};
}

export class RecordingSessionManager {
  private readonly active = new Map<string, ActiveRecording>();

  constructor(
    private readonly dependencies: {
      storage: Storage;
      adapter: BrowserAdapter;
    },
  ) {}

  async start(
    sourceUrl: string,
  ): Promise<{ sessionId: string; projectId: string }> {
    const normalizedUrl = validateRecordingUrl(sourceUrl);
    const timestamp = now();
    const project: Project = {
      schemaVersion: 1,
      id: randomUUID(),
      title: `SOP for ${new URL(normalizedUrl).hostname}`,
      sourceUrl: normalizedUrl,
      status: "starting",
      createdAt: timestamp,
      updatedAt: timestamp,
      steps: [],
      assets: [],
    };
    this.dependencies.storage.projects.save(project);
    let session: BrowserSession;
    try {
      session = await this.dependencies.adapter.launch(normalizedUrl);
    } catch (error) {
      const failedProject = this.updateProjectStatus(project, "failed");
      this.dependencies.storage.projects.save(failedProject);
      throw error;
    }
    const activeRecording: ActiveRecording = {
      project,
      session,
      rawEvents: [],
      screenshotAssets: new Map(),
      originalAssetsByHash: new Map(),
      annotatedAssetsByHash: new Map(),
      pending: new Set(),
      removeEventHandler: () => undefined,
      removeCloseHandler: () => undefined,
      subscribers: new Set(),
    };
    this.active.set(session.sessionId, activeRecording);
    this.dependencies.storage.sessions.create(
      session.sessionId,
      project.id,
      timestamp,
    );
    activeRecording.removeEventHandler = session.onEvent((event) => {
      const pending = this.handleEvent(session.sessionId, event);
      activeRecording.pending.add(pending);
      void pending.finally(() => activeRecording.pending.delete(pending));
    });
    activeRecording.removeCloseHandler = session.onUnexpectedClose(() => {
      void this.interrupt(session.sessionId);
    });
    activeRecording.project = this.updateProjectStatus(
      activeRecording.project,
      "recording",
    );
    this.dependencies.storage.projects.save(activeRecording.project);
    this.dependencies.storage.sessions.updateStatus(
      session.sessionId,
      "recording",
    );
    return { sessionId: session.sessionId, projectId: project.id };
  }

  async flush(sessionId: string): Promise<void> {
    const activeRecording = this.active.get(sessionId);
    if (!activeRecording) return;
    await Promise.all([...activeRecording.pending]);
  }

  async stop(sessionId: string): Promise<Project> {
    const activeRecording = this.requireActive(sessionId);
    activeRecording.project = this.updateProjectStatus(
      activeRecording.project,
      "stopping",
    );
    this.dependencies.storage.projects.save(activeRecording.project);
    this.dependencies.storage.sessions.updateStatus(sessionId, "stopping");
    for (const subscriber of activeRecording.subscribers) {
      subscriber({
        type: "status",
        status: "stopping",
        projectId: activeRecording.project.id,
      });
    }
    try {
      await this.flush(sessionId);
      activeRecording.removeEventHandler();
      activeRecording.removeCloseHandler();
      await activeRecording.session.stop();
      activeRecording.project = this.updateProjectStatus(
        activeRecording.project,
        "completed",
      );
      this.dependencies.storage.projects.save(activeRecording.project);
      this.dependencies.storage.sessions.updateStatus(
        sessionId,
        "completed",
        now(),
      );
      for (const subscriber of activeRecording.subscribers) {
        subscriber({
          type: "status",
          status: "completed",
          projectId: activeRecording.project.id,
        });
      }
    } catch (error) {
      activeRecording.project = this.updateProjectStatus(
        activeRecording.project,
        "failed",
      );
      this.dependencies.storage.projects.save(activeRecording.project);
      this.dependencies.storage.sessions.updateStatus(
        sessionId,
        "failed",
        now(),
      );
      for (const subscriber of activeRecording.subscribers) {
        subscriber({
          type: "status",
          status: "failed",
          projectId: activeRecording.project.id,
        });
        subscriber({
          type: "error",
          projectId: activeRecording.project.id,
          error: error instanceof Error ? error.message : "Recording failed.",
        });
      }
      this.active.delete(sessionId);
      throw error;
    }
    this.active.delete(sessionId);
    return activeRecording.project;
  }

  getProject(sessionId: string): Project | null {
    return this.active.get(sessionId)?.project ?? null;
  }

  subscribe(
    sessionId: string,
    handler: (message: unknown) => void,
  ): () => void {
    const activeRecording = this.requireActive(sessionId);
    activeRecording.subscribers.add(handler);
    handler({
      type: "status",
      status: activeRecording.project.status,
      projectId: activeRecording.project.id,
    });
    return () => activeRecording.subscribers.delete(handler);
  }

  async close(): Promise<void> {
    for (const sessionId of [...this.active.keys()]) {
      await this.stop(sessionId);
    }
  }

  private async interrupt(sessionId: string): Promise<void> {
    const activeRecording = this.active.get(sessionId);
    if (!activeRecording) return;
    await this.flush(sessionId);
    activeRecording.project = this.updateProjectStatus(
      activeRecording.project,
      "interrupted",
    );
    this.dependencies.storage.projects.save(activeRecording.project);
    this.dependencies.storage.sessions.updateStatus(
      sessionId,
      "interrupted",
      now(),
    );
    this.active.delete(sessionId);
  }

  private async handleEvent(sessionId: string, event: RawEvent): Promise<void> {
    const activeRecording = this.requireActive(sessionId);
    if (
      activeRecording.rawEvents.some((candidate) => candidate.id === event.id)
    )
      return;
    activeRecording.rawEvents.push(event);
    this.dependencies.storage.events.append(event);
    for (const subscriber of activeRecording.subscribers) {
      subscriber({
        type: "event",
        projectId: activeRecording.project.id,
        event,
      });
    }

    const originalAssetId = `asset-${event.id}-original`;
    try {
      const screenshot =
        event.type === "click"
          ? ((await activeRecording.session.screenshotForEvent(event.id)) ??
            (await activeRecording.session.screenshot()))
          : await activeRecording.session.screenshot();
      const metadata = await sharp(screenshot).metadata();
      const originalHash = createHash("sha256")
        .update(screenshot)
        .digest("hex");
      const original =
        activeRecording.originalAssetsByHash.get(originalHash) ??
        (await this.dependencies.storage.assets.write({
          projectId: activeRecording.project.id,
          assetId: originalAssetId,
          kind: "original",
          mimeType: "image/png",
          contents: screenshot,
          width: metadata.width,
          height: metadata.height,
        }));
      activeRecording.originalAssetsByHash.set(originalHash, original);
      activeRecording.project.assets = activeRecording.project.assets
        .filter((asset) => asset.id !== original.id)
        .concat(original);
      const annotated = await annotateScreenshot(
        screenshot,
        screenshotGeometry(event),
      );
      if (annotated.annotated) {
        const annotatedHash = createHash("sha256")
          .update(annotated.buffer)
          .digest("hex");
        const annotatedAsset =
          activeRecording.annotatedAssetsByHash.get(annotatedHash) ??
          (await this.dependencies.storage.assets.write({
            projectId: activeRecording.project.id,
            assetId: `asset-${event.id}-annotated`,
            kind: "annotated",
            mimeType: "image/png",
            contents: annotated.buffer,
            width: metadata.width,
            height: metadata.height,
          }));
        activeRecording.annotatedAssetsByHash.set(
          annotatedHash,
          annotatedAsset,
        );
        activeRecording.project.assets = activeRecording.project.assets
          .filter((asset) => asset.id !== annotatedAsset.id)
          .concat(annotatedAsset);
        activeRecording.screenshotAssets.set(event.id, annotatedAsset.id);
        for (const subscriber of activeRecording.subscribers) {
          subscriber({
            type: "asset",
            projectId: activeRecording.project.id,
            asset: annotatedAsset,
          });
        }
      } else {
        activeRecording.screenshotAssets.set(event.id, original.id);
        for (const subscriber of activeRecording.subscribers) {
          subscriber({
            type: "asset",
            projectId: activeRecording.project.id,
            asset: original,
          });
        }
      }
    } catch (error) {
      const failedAsset: Asset = {
        id: originalAssetId,
        kind: "original",
        status: "failed",
        error: error instanceof Error ? error.message : "Screenshot failed",
      };
      activeRecording.project.assets = activeRecording.project.assets
        .filter((asset) => asset.id !== failedAsset.id)
        .concat(failedAsset);
      for (const subscriber of activeRecording.subscribers) {
        subscriber({
          type: "error",
          projectId: activeRecording.project.id,
          eventId: event.id,
          error: failedAsset.error,
        });
      }
    }

    activeRecording.project.steps = normalizeRawEvents(
      activeRecording.rawEvents,
      activeRecording.screenshotAssets,
    );
    activeRecording.project.updatedAt = now();
    this.dependencies.storage.projects.save(activeRecording.project);
    for (const subscriber of activeRecording.subscribers) {
      subscriber({
        type: "step",
        projectId: activeRecording.project.id,
        steps: activeRecording.project.steps,
      });
    }
  }

  private updateProjectStatus(
    project: Project,
    status: SessionStatus,
  ): Project {
    return { ...project, status, updatedAt: now() };
  }

  private requireActive(sessionId: string): ActiveRecording {
    const activeRecording = this.active.get(sessionId);
    if (!activeRecording)
      throw new Error(`Recording session not found: ${sessionId}`);
    return activeRecording;
  }
}
