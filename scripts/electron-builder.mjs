import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const environment = { ...process.env };
if (!environment.CSC_LINK && !environment.WIN_CSC_LINK) {
  environment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}
if (process.platform === "darwin" && !environment.SDKROOT) {
  environment.SDKROOT = execFileSync("xcrun", ["--show-sdk-path"], {
    encoding: "utf8",
  }).trim();
}
if (process.platform === "darwin") {
  const libcxxInclude = path.join(environment.SDKROOT, "usr", "include", "c++", "v1");
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

const executableName = process.platform === "win32"
  ? "electron-builder.cmd"
  : "electron-builder";
const executable = path.resolve("node_modules", ".bin", executableName);
const result = spawnSync(executable, process.argv.slice(2), {
  env: environment,
  stdio: "inherit",
});

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const restore = spawnSync(npmExecutable, ["rebuild", "better-sqlite3", "sharp"], {
  env: environment,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (restore.error || restore.status !== 0) {
  console.error(restore.error ?? "Unable to restore host native modules.");
  process.exit(1);
}
process.exit(result.status ?? 1);