import { spawnSync } from "node:child_process";
import { constants, cpSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const [source, snapshot] = process.argv.slice(2);
const target = join(snapshot, ".git", "concord", "cache.hawdb");

function cacheInventory(path: string) {
  const entries = ["", ...readdirSync(path, { encoding: "utf8", recursive: true }).sort()];
  return entries
    .map((entry) => {
      const stat = lstatSync(join(path, entry), { bigint: true });
      if (!stat.isFile() && !stat.isDirectory()) throw new Error("Unsupported Concord cache entry");
      return [entry, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join("\0");
    })
    .join("\0");
}

function copyCache() {
  const stat = lstatSync(source, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return;

  // A running Concord service can write concurrently. Discard the copy if
  // any source file or directory changed while it was being made.
  const before = cacheInventory(source);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  cpSync(source, target, { recursive: true, mode: constants.COPYFILE_FICLONE });
  if (cacheInventory(source) !== before) throw new Error("Concord cache changed during copy");

  // Open only the private copy. Concord checks whether it can read the database.
  const status = spawnSync("concord", ["cache", "status", "--server", "command", "--json"], {
    cwd: snapshot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (status.status !== 0 || JSON.parse(status.stdout).status !== "ready") {
    throw new Error("Copied Concord cache is unavailable");
  }
}

try {
  copyCache();
} catch {
  rmSync(target, { recursive: true, force: true });
}
