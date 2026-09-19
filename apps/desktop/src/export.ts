import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type { Project, Step } from "../../../packages/domain/src/index.js";
import type { Storage } from "../../../packages/storage/src/index.js";

export interface ExportOptions {
  projectId: string;
  format: "folder" | "zip";
  destination: string;
}

export interface ExportItem {
  assetId: string;
  filename?: string;
  reason?: string;
}

export interface ExportResult {
  status: "completed" | "partial";
  destination: string;
  copied: ExportItem[];
  skipped: ExportItem[];
  failed: ExportItem[];
}

interface ExportAsset {
  assetId: string;
  sourcePath: string;
  filename: string;
}

function sanitizeFilename(value: string): string {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return sanitized || "screenshot";
}

function extensionForMimeType(mimeType?: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

function assetFilename(
  project: Project,
  step: Step | undefined,
  assetId: string,
  extension: string,
  index: number,
): string {
  const number = String(index + 1).padStart(2, "0");
  const title = sanitizeFilename(step?.title ?? project.title);
  return `${number}-${title}-${sanitizeFilename(assetId)}${extension}`;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function uniqueFilename(filename: string, used: Set<string>): string {
  if (!used.has(filename)) {
    used.add(filename);
    return filename;
  }
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  let suffix = 2;
  while (used.has(`${stem}-${suffix}${extension}`)) suffix += 1;
  const unique = `${stem}-${suffix}${extension}`;
  used.add(unique);
  return unique;
}

async function fileIsAvailable(sourcePath: string): Promise<boolean> {
  try {
    return (await stat(sourcePath)).isFile();
  } catch {
    return false;
  }
}

function collectAssets(
  project: Project,
  dataDir: string,
): { assets: ExportAsset[]; skipped: ExportItem[] } {
  const skipped: ExportItem[] = [];
  const assets: ExportAsset[] = [];
  const used = new Set<string>();
  const steps = [...project.steps].sort((left, right) => left.order - right.order);

  project.assets.forEach((asset, index) => {
    if (asset.status !== "ready" || !asset.relativePath) {
      skipped.push({ assetId: asset.id, reason: "Asset is not ready or has no path." });
      return;
    }
    const sourcePath = path.resolve(dataDir, asset.relativePath);
    if (!isWithin(path.resolve(dataDir), sourcePath)) {
      skipped.push({ assetId: asset.id, reason: "Asset path is outside the data directory." });
      return;
    }
    assets.push({
      assetId: asset.id,
      sourcePath,
      filename: uniqueFilename(
        assetFilename(
          project,
          steps.find((step) => step.screenshotAssetId === asset.id),
          asset.id,
          extensionForMimeType(asset.mimeType),
          index,
        ),
        used,
      ),
    });
  });

  return { assets, skipped };
}

async function exportToFolder(
  assets: ExportAsset[],
  destination: string,
): Promise<{ copied: ExportItem[]; failed: ExportItem[] }> {
  await mkdir(destination, { recursive: true });
  const copied: ExportItem[] = [];
  const failed: ExportItem[] = [];
  for (const asset of assets) {
    try {
      if (!(await fileIsAvailable(asset.sourcePath))) {
        failed.push({ assetId: asset.assetId, filename: asset.filename, reason: "Source image is missing." });
        continue;
      }
      const destinationPath = path.resolve(destination, asset.filename);
      if (!isWithin(path.resolve(destination), destinationPath)) {
        failed.push({ assetId: asset.assetId, filename: asset.filename, reason: "Unsafe export filename." });
        continue;
      }
      await copyFile(asset.sourcePath, destinationPath);
      copied.push({ assetId: asset.assetId, filename: asset.filename });
    } catch (error) {
      failed.push({
        assetId: asset.assetId,
        filename: asset.filename,
        reason: error instanceof Error ? error.message : "Unable to copy image.",
      });
    }
  }
  return { copied, failed };
}

async function exportToZip(
  assets: ExportAsset[],
  destination: string,
): Promise<{ copied: ExportItem[]; failed: ExportItem[] }> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  const copied: ExportItem[] = [];
  const failed: ExportItem[] = [];
  const output = createWriteStream(temporaryPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const closePromise = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  for (const asset of assets) {
    if (!(await fileIsAvailable(asset.sourcePath))) {
      failed.push({ assetId: asset.assetId, filename: asset.filename, reason: "Source image is missing." });
      continue;
    }
    archive.file(asset.sourcePath, { name: asset.filename });
    copied.push({ assetId: asset.assetId, filename: asset.filename });
  }
  await archive.finalize();
  try {
    await closePromise;
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { copied, failed };
}

export async function exportProjectImages(
  storage: Storage,
  dataDir: string,
  options: ExportOptions,
): Promise<ExportResult> {
  const project = storage.projects.load(options.projectId);
  if (!project) throw new Error("Project not found.");
  const destination = path.resolve(options.destination);
  const collected = collectAssets(project, dataDir);
  const exported =
    options.format === "folder"
      ? await exportToFolder(collected.assets, destination)
      : await exportToZip(collected.assets, destination);
  return {
    status: collected.skipped.length || exported.failed.length ? "partial" : "completed",
    destination,
    copied: exported.copied,
    skipped: collected.skipped,
    failed: exported.failed,
  };
}