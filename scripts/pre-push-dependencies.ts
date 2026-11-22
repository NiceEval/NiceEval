import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

const [sourceRoot, snapshotRoot] = process.argv.slice(2).map((path) => realpathSync(path));

function copyFile(source: string, target: string, reuse: boolean) {
  if (reuse) {
    try {
      linkSync(source, target);
      return;
    } catch (error) {
      // A temp directory may be on another filesystem, and pnpm's store
      // files may already be at the filesystem's hard-link limit.
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EMLINK", "EXDEV", "EPERM", "ENOTSUP"].includes(code)) throw error;
    }
  }
  copyFileSync(source, target, constants.COPYFILE_FICLONE);
}

function mirrorDirectory(source: string, target: string, workspaceRoot: boolean, path: string[] = []) {
  mkdirSync(target);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    // Keep installed packages and shims. Each check starts with fresh task
    // and tool caches under node_modules.
    if (path.length === 0 && entry.name.startsWith(".") && entry.name !== ".bin") {
      // Only the root owns a virtual store in this workspace.
      if (!(workspaceRoot && [".modules.yaml", ".pnpm"].includes(entry.name))) continue;
    }
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      const link = readlinkSync(from);
      const fromRoot = relative(sourceRoot, link);
      // pnpm's relative workspace links already work in the snapshot.
      const internal = isAbsolute(link) && !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
      symlinkSync(internal ? join(snapshotRoot, fromRoot) : link, to);
    } else if (entry.isDirectory()) {
      mirrorDirectory(from, to, workspaceRoot, [...path, entry.name]);
    } else {
      // pnpm already treats virtual-store package files as shared payloads.
      // Copy metadata and shims so pnpm can update them inside the snapshot.
      const installedPackage = path[0] === ".pnpm" && path[2] === "node_modules";
      copyFile(from, to, installedPackage);
    }
  }
}

if (!existsSync(join(sourceRoot, "node_modules", ".modules.yaml"))) {
  throw new Error("Install the workspace dependencies before pushing.");
}

const importers = ["."];
for (const parent of ["apps", "packages"]) {
  const directory = join(snapshotRoot, parent);
  if (!existsSync(directory)) continue;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) importers.push(join(parent, entry.name));
  }
}

for (const importer of importers) {
  const dependencyPath = join(importer, "node_modules");
  const source = join(sourceRoot, dependencyPath);
  if (existsSync(source)) mirrorDirectory(source, join(snapshotRoot, dependencyPath), importer === ".");
}

// pnpm revalidates the copied installation against the snapshot's manifests.
// Rebase its absolute workspace paths while retaining the validation digests
// and nanosecond timestamps, which JSON.parse would round.
const statePath = join("node_modules", ".pnpm-workspace-state-v1.json");
const stateSource = join(sourceRoot, statePath);
if (existsSync(stateSource)) {
  const state = readFileSync(stateSource, "utf8");
  const sourcePrefix = JSON.stringify(sourceRoot + sep).slice(0, -1);
  const snapshotPrefix = JSON.stringify(snapshotRoot + sep).slice(0, -1);
  const adapted = state
    .replaceAll(sourcePrefix, () => snapshotPrefix)
    .replaceAll(JSON.stringify(sourceRoot), () => JSON.stringify(snapshotRoot));
  writeFileSync(join(snapshotRoot, statePath), adapted);
}
