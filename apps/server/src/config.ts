import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 3001),
    dataDir: path.resolve(env.DATA_DIR ?? ".sop-forge"),
  };
}
