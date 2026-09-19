import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalServer } from "../dist-electron/apps/server/src/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "sop-forge-desktop-smoke-"));
const runtime = await startLocalServer({
  host: "127.0.0.1",
  port: 0,
  dataDir,
  webRoot: path.join(root, "dist-web"),
  adapter: { launch: async () => ({}) },
});

try {
  const health = await fetch(`${runtime.url}/api/health`);
  if (!health.ok) throw new Error(`Health check failed: ${health.status}`);

  const project = {
    schemaVersion: 1,
    id: "desktop-smoke-project",
    title: "Desktop smoke project",
    sourceUrl: "https://example.com",
    status: "completed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [],
    assets: [],
  };
  runtime.storage.projects.save(project);
  const asset = await runtime.storage.assets.write({
    projectId: project.id,
    assetId: "desktop-smoke-asset",
    kind: "original",
    mimeType: "image/png",
    contents: Buffer.from("desktop-smoke-image"),
  });
  runtime.storage.projects.save({ ...project, assets: [asset] });

  const loaded = await fetch(`${runtime.url}/api/projects/${project.id}`);
  if (!loaded.ok) throw new Error(`Project load failed: ${loaded.status}`);
  const assetResponse = await fetch(`${runtime.url}/api/assets/${asset.relativePath}`);
  if (!assetResponse.ok) throw new Error(`Asset load failed: ${assetResponse.status}`);
  const pdfResponse = await fetch(`${runtime.url}/api/projects/${project.id}/pdf`, { method: "POST" });
  if (!pdfResponse.ok) throw new Error(`PDF export failed: ${pdfResponse.status}`);
  const pdfPath = path.join(dataDir, "projects", project.id, "sop.pdf");
  const pdf = await readFile(pdfPath);
  if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF signature is invalid.");
  await writeFile(path.join(dataDir, "smoke-complete"), "ok");
  console.log(`Desktop smoke passed: ${runtime.url}`);
} finally {
  await runtime.close();
  await rm(dataDir, { recursive: true, force: true });
}