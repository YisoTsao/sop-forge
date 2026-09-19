import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateLegacyData } from "./data-paths.js";
import { exportProjectImages } from "./export.js";
import { startLocalServer, type LocalServer } from "../../server/src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let runtime: LocalServer | undefined;
let mainWindow: BrowserWindow | undefined;
let shutdownRequested = false;

ipcMain.handle(
  "export-project-images",
  async (_event, request: { projectId: string; format: "folder" | "zip" }) => {
    if (!runtime) throw new Error("SOP Forge runtime is not ready.");
    const parent = mainWindow;
    if (!parent) throw new Error("SOP Forge window is not available.");
    if (
      !request ||
      typeof request.projectId !== "string" ||
      !request.projectId.trim() ||
      (request.format !== "folder" && request.format !== "zip")
    ) {
      throw new Error("Invalid image export request.");
    }
    let destination: string | undefined;
    if (request.format === "folder") {
      const selection = await dialog.showOpenDialog(parent, {
        properties: ["createDirectory", "openDirectory"],
        title: "Choose image export folder",
      });
      destination = selection.canceled ? undefined : selection.filePaths[0];
    } else {
      const selection = await dialog.showSaveDialog(parent, {
        defaultPath: "sop-forge-images.zip",
        filters: [{ name: "ZIP archive", extensions: ["zip"] }],
        title: "Save image export ZIP",
      });
      destination = selection.canceled ? undefined : selection.filePath;
    }
    if (!destination) return { status: "cancelled", copied: 0, skipped: 0, failed: 0 };
    const result = await exportProjectImages(runtime.storage, runtime.storage.dataDir, {
      projectId: request.projectId,
      format: request.format,
      destination,
    });
    return {
      status: result.status,
      destination: result.destination,
      copied: result.copied.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
      skippedItems: result.skipped,
      failedItems: result.failed,
    };
  },
);

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function packagedWebRoot(): string {
  return path.resolve(__dirname, "../../../../dist-web");
}

async function createMainWindow(): Promise<void> {
  if (!runtime) {
    const webRoot = packagedWebRoot();
    if (!existsSync(path.join(webRoot, "index.html"))) {
      throw new Error(`Web build is missing: ${webRoot}`);
    }
    const dataDir =
      process.env.DATA_DIR ?? path.join(app.getPath("userData"), "data");
    if (app.isPackaged) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
        process.resourcesPath,
        "playwright-browsers",
      );
    }
    const migration = await migrateLegacyData(
      path.resolve(process.cwd(), ".sop-forge"),
      dataDir,
    );
    if (migration.status === "migrated")
      console.info(`Migrated local data to ${migration.destinationDir}`);
    runtime = await startLocalServer({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      webRoot,
    });
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  await mainWindow.loadURL(runtime.url);
}

async function shutdown(): Promise<void> {
  await runtime?.close();
  runtime = undefined;
  app.quit();
}

if (hasSingleInstance) {
  app.whenReady().then(() => createMainWindow()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("SOP Forge could not start", message);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      void createMainWindow().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox("SOP Forge could not open", message);
      });
  });

  app.on("before-quit", (event) => {
    if (shutdownRequested || !runtime) return;
    event.preventDefault();
    shutdownRequested = true;
    void shutdown().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("SOP Forge could not shut down cleanly", message);
      app.exit(1);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}