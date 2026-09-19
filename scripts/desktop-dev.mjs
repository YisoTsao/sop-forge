import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const electronExecutable = path.resolve(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);
const electronPackage = JSON.parse(
  readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8"),
);
const environment = { ...process.env };

if (process.platform === "darwin") {
  environment.SDKROOT ??= execFileSync("xcrun", ["--show-sdk-path"], {
    encoding: "utf8",
  }).trim();
  const libcxxInclude = path.join(
    environment.SDKROOT,
    "usr",
    "include",
    "c++",
    "v1",
  );
  environment.CPLUS_INCLUDE_PATH = [
    libcxxInclude,
    environment.CPLUS_INCLUDE_PATH,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  environment.CXXFLAGS = [environment.CXXFLAGS, `-I${libcxxInclude}`]
    .filter(Boolean)
    .join(" ");
}

function rebuild(runtime, target) {
  const args = ["rebuild", "better-sqlite3", "sharp"];
  if (runtime) {
    args.push("--runtime=electron", `--target=${target}`, "--dist-url=https://electronjs.org/headers");
  }
  const result = spawnSync(npmExecutable, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`npm rebuild failed for ${runtime ?? "host Node.js"}.`);
  }
}

let exitCode = 1;
let child;
try {
  rebuild("electron", electronPackage.version);
  child = spawn(
    electronExecutable,
    ["dist-electron/apps/desktop/src/main.js", ...process.argv.slice(2)],
    { cwd: root, env: environment, stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child?.kill(signal));
  }
  exitCode = await new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  try {
    rebuild(undefined);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = 1;
  }
}

process.exit(exitCode);