import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.CI || !existsSync(resolve(root, ".git"))) process.exit(0);

const configured = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  cwd: root,
  stdio: "inherit",
});

if (configured.error) throw configured.error;
if (configured.status !== 0) process.exit(configured.status ?? 1);
