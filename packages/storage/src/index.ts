import {
  mkdirSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  assetSchema,
  projectSchema,
  type Asset,
  type Project,
  type RawEvent,
} from "../../domain/src/index.js";

type SqliteDatabase = InstanceType<typeof Database>;

const CURRENT_SCHEMA_VERSION = 1;

function initializeDatabase(db: SqliteDatabase): void {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS raw_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(session_id, id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS targets (
      step_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (step_id) REFERENCES steps(id)
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      relative_path TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      error TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `);

  const migration = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(CURRENT_SCHEMA_VERSION);
  if (!migration) {
    db.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
  }
}

function projectWithAvailableAssets(
  project: Project,
  dataDir: string,
): Project {
  return projectSchema.parse({
    ...project,
    assets: project.assets.map((asset) => {
      if (asset.status !== "ready" || !asset.relativePath) return asset;
      if (existsSync(path.join(dataDir, asset.relativePath))) return asset;
      return { ...asset, status: "unavailable" as const };
    }),
  });
}

function saveProject(db: SqliteDatabase, project: Project): void {
  const transaction = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO projects (id, schema_version, title, source_url, status, payload_json, created_at, updated_at)
      VALUES (@id, @schemaVersion, @title, @sourceUrl, @status, @payload, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        schema_version = excluded.schema_version,
        title = excluded.title,
        source_url = excluded.source_url,
        status = excluded.status,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `,
    ).run({
      id: project.id,
      schemaVersion: project.schemaVersion,
      title: project.title,
      sourceUrl: project.sourceUrl,
      status: project.status,
      payload: JSON.stringify(project),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });

    db.prepare("DELETE FROM steps WHERE project_id = ?").run(project.id);
    db.prepare("DELETE FROM assets WHERE project_id = ?").run(project.id);
    const stepStatement = db.prepare(`
      INSERT INTO steps (id, project_id, display_order, action, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const assetStatement = db.prepare(`
      INSERT INTO assets (id, project_id, kind, status, relative_path, mime_type, width, height, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const step of project.steps) {
      stepStatement.run(
        step.id,
        project.id,
        step.order,
        step.action,
        JSON.stringify(step),
      );
    }
    for (const asset of project.assets) {
      assetStatement.run(
        asset.id,
        project.id,
        asset.kind,
        asset.status,
        asset.relativePath ?? null,
        asset.mimeType ?? null,
        asset.width ?? null,
        asset.height ?? null,
        asset.error ?? null,
      );
    }
  });

  transaction();
}

function loadProject(
  db: SqliteDatabase,
  dataDir: string,
  id: string,
): Project | null {
  const row = db
    .prepare("SELECT payload_json FROM projects WHERE id = ?")
    .get(id) as { payload_json?: string } | undefined;
  if (!row?.payload_json) return null;
  return projectWithAvailableAssets(
    projectSchema.parse(JSON.parse(row.payload_json)),
    dataDir,
  );
}

export interface AssetWriteInput {
  projectId: string;
  assetId: string;
  kind: Asset["kind"];
  mimeType: string;
  contents: Uint8Array;
  width?: number;
  height?: number;
}

export interface Storage {
  dataDir: string;
  db: SqliteDatabase;
  projects: {
    save(project: Project): void;
    load(id: string): Project | null;
    list(): Project[];
  };
  sessions: {
    create(id: string, projectId: string, startedAt: string): void;
    updateStatus(id: string, status: string, endedAt?: string): void;
  };
  events: {
    append(event: RawEvent): void;
    list(sessionId: string): RawEvent[];
  };
  assets: {
    write(input: AssetWriteInput): Promise<Asset>;
  };
  close(): void;
}

export function createStorage(dataDir: string): Storage {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "sop-forge.db");
  const db = new Database(dbPath);
  initializeDatabase(db);

  return {
    dataDir,
    db,
    projects: {
      save(project) {
        saveProject(db, projectSchema.parse(project));
      },
      load(id) {
        return loadProject(db, dataDir, id);
      },
      list() {
        const rows = db
          .prepare("SELECT id FROM projects ORDER BY updated_at DESC")
          .all() as Array<{ id: string }>;
        return rows.flatMap((row) => {
          const project = loadProject(db, dataDir, row.id);
          return project ? [project] : [];
        });
      },
    },
    sessions: {
      create(id, projectId, startedAt) {
        db.prepare(
          `
          INSERT INTO sessions (id, project_id, status, started_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
        ).run(id, projectId, "recording", startedAt);
      },
      updateStatus(id, status, endedAt) {
        db.prepare(
          "UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?",
        ).run(status, endedAt ?? null, id);
      },
    },
    events: {
      append(event) {
        db.prepare(
          `
          INSERT INTO raw_events (id, session_id, sequence, type, timestamp, payload_json)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
        ).run(
          event.id,
          event.sessionId,
          event.sequence,
          event.type,
          event.timestamp,
          JSON.stringify(event),
        );
      },
      list(sessionId) {
        const rows = db
          .prepare(
            "SELECT payload_json FROM raw_events WHERE session_id = ? ORDER BY sequence",
          )
          .all(sessionId) as Array<{ payload_json: string }>;
        return rows.map((row) => JSON.parse(row.payload_json) as RawEvent);
      },
    },
    assets: {
      async write(input) {
        const extension =
          input.mimeType === "image/png"
            ? "png"
            : (input.mimeType.split("/")[1] ?? "bin");
        const relativePath = path.join(
          "projects",
          input.projectId,
          "assets",
          `${input.assetId}.${extension}`,
        );
        const absolutePath = path.join(dataDir, relativePath);
        mkdirSync(path.dirname(absolutePath), { recursive: true });
        const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
        writeFileSync(temporaryPath, input.contents);
        renameSync(temporaryPath, absolutePath);

        const asset = assetSchema.parse({
          id: input.assetId,
          kind: input.kind,
          status: "ready",
          relativePath,
          mimeType: input.mimeType,
          width: input.width,
          height: input.height,
        });
        db.prepare(
          `
          INSERT INTO assets (id, project_id, kind, status, relative_path, mime_type, width, height)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            status = excluded.status,
            relative_path = excluded.relative_path,
            mime_type = excluded.mime_type,
            width = excluded.width,
            height = excluded.height,
            error = NULL
        `,
        ).run(
          input.assetId,
          input.projectId,
          asset.kind,
          asset.status,
          asset.relativePath,
          asset.mimeType,
          asset.width ?? null,
          asset.height ?? null,
        );
        return asset;
      },
    },
    close() {
      db.close();
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    },
  };
}

export { initializeDatabase };
