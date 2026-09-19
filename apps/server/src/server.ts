import type { AddressInfo } from "node:net";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PlaywrightBrowserAdapter } from "../../../packages/capture/src/playwright-adapter.js";
import {
  RecordingSessionManager,
  type BrowserAdapter,
} from "../../../packages/recording/src/index.js";
import { createStorage, type Storage } from "../../../packages/storage/src/index.js";

export interface LocalServerOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  adapter?: BrowserAdapter;
  webRoot?: string;
}

export interface LocalServer {
  app: Awaited<ReturnType<typeof buildApp>>;
  manager: RecordingSessionManager;
  storage: Storage;
  url: string;
  close(): Promise<void>;
}

function listeningUrl(app: LocalServer["app"], host: string): string {
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("Local server did not expose a TCP address.");
  return `http://${host}:${(address as AddressInfo).port}`;
}

export async function startLocalServer(
  options: LocalServerOptions = {},
): Promise<LocalServer> {
  const config = loadConfig();
  const host = options.host ?? config.host;
  const port = options.port ?? config.port;
  const storage = createStorage(options.dataDir ?? config.dataDir);
  const manager = new RecordingSessionManager({
    storage,
    adapter: options.adapter ?? new PlaywrightBrowserAdapter(),
  });
  let url = `http://${host}:${port}`;
  const app = await buildApp({
    manager,
    storage,
    publicBaseUrl: () => url,
    webRoot: options.webRoot,
  });

  try {
    await app.listen({ host, port });
    url = listeningUrl(app, host);
  } catch (error) {
    storage.close();
    throw error;
  }

  let closed = false;
  return {
    app,
    manager,
    storage,
    get url() {
      return url;
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await manager.close();
      } finally {
        try {
          await app.close();
        } finally {
          storage.close();
        }
      }
    },
  };
}