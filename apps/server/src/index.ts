import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { PlaywrightBrowserAdapter } from "../../../packages/capture/src/playwright-adapter.js";
import { RecordingSessionManager } from "../../../packages/recording/src/index.js";
import { createStorage } from "../../../packages/storage/src/index.js";

const config = loadConfig();
const storage = createStorage(config.dataDir);
const manager = new RecordingSessionManager({
  storage,
  adapter: new PlaywrightBrowserAdapter(),
});
const appPromise = buildApp({
  manager,
  storage,
  publicBaseUrl: `http://${config.host}:${config.port}`,
});

if (process.env.NODE_ENV !== "test") {
  appPromise
    .then((app) => app.listen({ host: config.host, port: config.port }))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { appPromise };
