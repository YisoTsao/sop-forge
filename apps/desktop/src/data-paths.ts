import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const MIGRATION_VERSION = 1;
const MIGRATION_MARKER = ".sop-forge-migration.json";

export type MigrationStatus =
  | "not-needed"
  | "already-migrated"
  | "skipped-non-empty"
  | "migrated";

export interface MigrationResult {
  status: MigrationStatus;
  sourceDir: string;
  destinationDir: string;
}

async function directoryEntries(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function migrateLegacyData(
  sourceDir: string,
  destinationDir: string,
): Promise<MigrationResult> {
  await mkdir(destinationDir, { recursive: true });
  const markerPath = path.join(destinationDir, MIGRATION_MARKER);
  try {
    await readFile(markerPath, "utf8");
    return { status: "already-migrated", sourceDir, destinationDir };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const sourceEntries = await directoryEntries(sourceDir);
  if (sourceEntries.length === 0)
    return { status: "not-needed", sourceDir, destinationDir };

  const destinationEntries = await directoryEntries(destinationDir);
  if (destinationEntries.length > 0)
    return { status: "skipped-non-empty", sourceDir, destinationDir };

  const copiedEntries: string[] = [];
  try {
    for (const entry of sourceEntries) {
      const sourcePath = path.join(sourceDir, entry);
      const destinationPath = path.join(destinationDir, entry);
      await cp(sourcePath, destinationPath, { recursive: true, force: false });
      copiedEntries.push(destinationPath);
    }
    await writeFile(
      markerPath,
      JSON.stringify(
        {
          version: MIGRATION_VERSION,
          sourceDir,
          migratedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    return { status: "migrated", sourceDir, destinationDir };
  } catch (error) {
    await Promise.all(
      copiedEntries.map((entry) => rm(entry, { recursive: true, force: true })),
    );
    throw new Error(
      `Unable to migrate local SOP Forge data: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}