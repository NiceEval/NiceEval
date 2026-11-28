import type Docker from "dockerode";
import { IncomingMessage } from "node:http";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar-stream";
import type { StateManifest } from "../state/protocol.ts";
import { DEFAULT_LEDGER_EXPORT_DIR, DEFAULT_LEDGER_GIT_DIR } from "./ledger-paths.ts";
import {
  StateFileError,
  StateQuiescenceError,
  StateRootPreexistingError,
  type SandboxStateFiles,
} from "./state-files.ts";

export const DOCKER_SANDBOX_WORKDIR = "/home/sandbox/workspace";

export function localDockerSupportsState(readOnly: boolean): boolean {
  const host = process.env.DOCKER_HOST;
  return process.platform !== "win32" && (host === undefined || host === "" || host.startsWith("unix://")) && !readOnly;
}

type Root = StateManifest["roots"][number];
type MemberType = "directory" | "file";
type PathStat = { readonly type: MemberType; readonly mode: number; readonly size: number };
type Change = { readonly path: string; readonly deleted: boolean };

function within(root: string, path: string): boolean {
  return path === root || path.startsWith(root + "/");
}

function filePath(path: string): string[] {
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.includes("\0"))) {
    throw new Error(`Invalid Docker State archive path ${JSON.stringify(path)}.`);
  }
  return parts;
}

function validateHeader(header: tar.Header): string {
  const name = header.type === "directory" ? header.name.replace(/\/$/u, "") : header.name;
  filePath(name);
  if (
    (header.type !== "file" && header.type !== "directory") ||
    (header.linkname !== "" && header.linkname !== null) ||
    !Number.isSafeInteger(header.size) ||
    header.size < 0 ||
    (header.type === "directory" && header.size !== 0)
  ) {
    throw new Error(`Unsupported Docker State archive entry ${JSON.stringify(name)} (${header.type}).`);
  }
  return name;
}

function writeHeader(header: tar.Header, name: string): Parameters<tar.Pack["entry"]>[0] {
  return {
    name,
    type: header.type,
    size: header.size,
    mode: header.mode,
    uid: header.uid,
    gid: header.gid,
    mtime: new Date(0),
  };
}

function absentPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404;
}

async function statPath(container: Docker.Container, path: string, signal: AbortSignal): Promise<PathStat | undefined> {
  let response: unknown;
  try {
    response = await container.infoArchive({ path, abortSignal: signal });
  } catch (error) {
    if (absentPath(error)) {
      // HEAD also returns 404 when the container itself has disappeared.
      await container.inspect({ abortSignal: signal });
      return undefined;
    }
    throw error;
  }
  if (!(response instanceof IncomingMessage)) throw new Error("Docker archive HEAD did not return HTTP headers.");
  response.resume();
  const encoded = response.headers["x-docker-container-path-stat"];
  if (typeof encoded !== "string") throw new Error(`Docker did not report the file type of ${JSON.stringify(path)}.`);
  const info: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  if (
    info === null ||
    typeof info !== "object" ||
    !("mode" in info) ||
    typeof info.mode !== "number" ||
    !Number.isSafeInteger(info.mode) ||
    !("size" in info) ||
    typeof info.size !== "number" ||
    !Number.isSafeInteger(info.size) ||
    info.size < 0 ||
    !("linkTarget" in info) ||
    info.linkTarget !== ""
  ) {
    throw new StateFileError(
      "state-path-conflict",
      `Invalid Docker stat or linked State path ${JSON.stringify(path)}.`,
    );
  }
  // Go os.FileMode stores type bits in its high word.
  const type = (info.mode & 0x8f280000) >>> 0;
  if (type !== 0 && type !== 0x80000000) {
    throw new Error(`Unsupported Docker State path type at ${JSON.stringify(path)}.`);
  }
  return { type: type === 0 ? "file" : "directory", mode: info.mode & 0o777, size: info.size };
}

async function inspectPath(container: Docker.Container, path: string, signal: AbortSignal) {
  const segments = filePath(path.slice(1));
  let current = "";
  for (const [index, segment] of segments.entries()) {
    current += "/" + segment;
    const entry = await statPath(container, current, signal);
    if (entry === undefined || index === segments.length - 1) return entry;
    if (entry.type !== "directory")
      throw new StateFileError(
        "state-path-conflict",
        `Docker State ancestor ${JSON.stringify(current)} is not a directory.`,
      );
  }
}

async function* extractEntries(source: AsyncIterable<Uint8Array> | Readable, signal: AbortSignal) {
  const extract = tar.extract();
  const reading = pipeline(source, extract, { signal });
  void reading.catch(() => {});
  try {
    yield* extract;
    await reading;
  } finally {
    extract.destroy();
    await reading.catch(() => {});
  }
}

function packedArchive(write: (pack: tar.Pack) => Promise<void>): Readable {
  async function* chunks() {
    const pack = tar.pack();
    const writing = write(pack).then(
      () => pack.finalize(),
      (error: Error) => pack.destroy(error),
    );
    try {
      yield* pack;
    } finally {
      pack.destroy();
      await writing;
    }
  }
  return Readable.from(chunks(), { objectMode: false });
}

async function readChanges(container: Docker.Container, signal: AbortSignal): Promise<readonly Change[]> {
  const raw: unknown = await container.changes({ abortSignal: signal });
  if (raw === null || (Buffer.isBuffer(raw) && raw.toString() === "null")) return [];
  if (!Array.isArray(raw)) throw new Error("Docker changes did not return a list.");
  return raw.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("Path" in entry) ||
      typeof entry.Path !== "string" ||
      !entry.Path.startsWith("/") ||
      !("Kind" in entry) ||
      (entry.Kind !== 0 && entry.Kind !== 1 && entry.Kind !== 2)
    ) {
      throw new Error("Docker changes returned an invalid entry.");
    }
    return { path: entry.Path, deleted: entry.Kind === 2 };
  });
}

async function memberList(container: Docker.Container, root: Root, changes: readonly Change[], signal: AbortSignal) {
  const expected = new Map<string, PathStat>();
  const members = changes
    .filter(({ path }) => within(root.resolved, path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { path, deleted } of members) {
    filePath(path.slice(1));
    if (deleted || !root.present || expected.has(path)) {
      throw new Error(`Unexpected Docker change at State path ${JSON.stringify(path)}.`);
    }
    if (path !== root.resolved && expected.get(posix.dirname(path))?.type !== "directory") {
      throw new Error(`Docker changes omitted a State ancestor of ${JSON.stringify(path)}.`);
    }
    const info = await statPath(container, path, signal);
    if (info === undefined || (info.mode & 0o444) === 0 || (info.type === "directory" && (info.mode & 0o111) === 0)) {
      throw new Error(`Cannot read Docker State path ${JSON.stringify(path)}.`);
    }
    expected.set(path, info);
  }
  if (root.present && !expected.has(root.resolved)) {
    throw new Error(`Docker changes omitted State root ${JSON.stringify(root.resolved)}.`);
  }
  return expected;
}

async function captureRoot(
  container: Docker.Container,
  pack: tar.Pack,
  root: Root,
  ordinal: number,
  changes: readonly Change[],
  signal: AbortSignal,
) {
  const remaining = await memberList(container, root, changes, signal);
  if (!root.present) return;
  const archive = await container.getArchive({ path: root.resolved, abortSignal: signal });
  if (!(archive instanceof Readable)) throw new Error("Docker archive GET did not return a readable stream.");
  const basename = posix.basename(root.resolved);
  for await (const entry of extractEntries(archive, signal)) {
    const header = entry.header;
    const name = validateHeader(header);
    if (!within(basename, name)) throw new Error(`Docker archive path escapes State root: ${JSON.stringify(name)}.`);
    const suffix = name.slice(basename.length);
    const path = root.resolved + suffix;
    const expected = remaining.get(path);
    if (
      expected === undefined ||
      expected.type !== header.type ||
      expected.mode !== (header.mode & 0o777) ||
      (header.type === "file" && expected.size !== header.size)
    ) {
      throw new Error(`Docker archive entry does not match its State change: ${JSON.stringify(path)}.`);
    }
    remaining.delete(path);
    await pipeline(entry, pack.entry(writeHeader(header, String(ordinal) + suffix)), { signal });
  }
  if (remaining.size > 0) {
    throw new Error(`Docker archive omitted State path ${JSON.stringify(remaining.keys().next().value)}.`);
  }
}

async function restoreArchive(
  container: Docker.Container,
  manifest: StateManifest,
  chunks: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
) {
  const roots = new Map(
    manifest.roots.flatMap((root, ordinal) => (root.present ? [[String(ordinal), root] as const] : [])),
  );
  const members = new Map<string, MemberType>();
  const missingRoots = new Set(roots.keys());
  const archive = packedArchive(async (pack) => {
    for await (const entry of extractEntries(chunks, signal)) {
      const name = validateHeader(entry.header);
      const [ordinal] = name.split("/", 1);
      const root = ordinal === undefined ? undefined : roots.get(ordinal);
      if (
        root === undefined ||
        members.has(name) ||
        (name !== ordinal && members.get(posix.dirname(name)) !== "directory")
      ) {
        throw new Error(`Invalid or duplicate checkpoint State entry ${JSON.stringify(name)}.`);
      }
      if (entry.header.type !== "directory" && entry.header.type !== "file")
        throw new Error("Invalid checkpoint entry type.");
      members.set(name, entry.header.type);
      missingRoots.delete(name);
      await pipeline(
        entry,
        pack.entry(writeHeader(entry.header, root.resolved.slice(1) + name.slice(ordinal.length))),
        { signal },
      );
    }
    if (missingRoots.size > 0) throw new Error("The State checkpoint omitted a declared present root.");
  });
  try {
    if (roots.size > 0) {
      await container.putArchive(archive, { path: "/", noOverwriteDirNonDir: true, abortSignal: signal });
    } else {
      // Consume and validate the checkpoint even when there is nothing to write.
      for await (const _chunk of archive) {
        /* the tar contains only its end marker */
      }
    }
  } finally {
    archive.destroy();
  }
}

async function hasOnlySupervisor(container: Docker.Container, pid: number, logPath: string, signal: AbortSignal) {
  const output: unknown = await container.top({ ps_args: "-eo pid,ppid,args", abortSignal: signal });
  if (
    output === null ||
    typeof output !== "object" ||
    !("Processes" in output) ||
    !Array.isArray(output.Processes) ||
    output.Processes.length !== 2
  )
    return false;
  const rows: readonly unknown[] = output.Processes;
  const tail = `tail -n +1 -F ${logPath}`;
  return (
    rows.every((row) => Array.isArray(row) && row.length === 3) &&
    rows.some(
      (row) =>
        Array.isArray(row) &&
        row[0] === String(pid) &&
        typeof row[2] === "string" &&
        /^timeout [0-9]+ /u.test(row[2]) &&
        row[2].replace(/^timeout [0-9]+ /u, "") === tail,
    ) &&
    rows.some((row) => Array.isArray(row) && row[1] === String(pid) && row[2] === tail)
  );
}

export function createDockerStateFiles(input: {
  readonly container: () => Docker.Container;
  readonly home: () => string;
  readonly workdir: string;
  readonly logPath: string;
  readonly npmDirectory: () => string;
}): SandboxStateFiles {
  let frozen: Docker.Container | undefined;
  let changes: Promise<readonly Change[]> | undefined;
  async function withQuiescence(signal: AbortSignal, capture: () => Promise<void>) {
    const container = input.container();
    try {
      try {
        await container.pause({ abortSignal: signal });
        const { State } = await container.inspect({ abortSignal: signal });
        if (!State.Paused || !(await hasOnlySupervisor(container, State.Pid, input.logPath, signal))) return false;
      } catch (cause) {
        throw new StateQuiescenceError("Cannot prove the Docker Sandbox is quiescent.", { cause });
      }
      frozen = container;
      await capture();
      return true;
    } finally {
      frozen = undefined;
      changes = undefined;
      try {
        const cleanupSignal = AbortSignal.timeout(5000);
        const { State } = await container.inspect({ abortSignal: cleanupSignal });
        if (State.Paused) await container.unpause({ abortSignal: cleanupSignal });
      } catch (cause) {
        throw new StateQuiescenceError("Cannot confirm the Docker Sandbox was unfrozen.", { cause });
      }
    }
  }

  async function resolve(paths: readonly string[], signal: AbortSignal): Promise<StateManifest> {
    const container = input.container();
    const inspect = await container.inspect({ abortSignal: signal });
    const forbidden = [
      input.logPath,
      input.npmDirectory(),
      DEFAULT_LEDGER_GIT_DIR,
      DEFAULT_LEDGER_EXPORT_DIR,
      "/proc",
      "/sys",
      "/dev",
      "/etc/hosts",
      "/etc/hostname",
      "/etc/resolv.conf",
      "/tmp/niceeval-checkout-cache",
      ...inspect.Mounts.map(({ Destination }) => Destination),
      ...Object.keys(inspect.HostConfig.Tmpfs ?? {}),
    ];
    const roots: Root[] = [];
    for (const declared of paths) {
      const resolved = declared.startsWith("~/") ? posix.join(input.home(), declared.slice(2)) : declared;
      if (within(input.workdir, resolved) || within(resolved, input.workdir)) {
        throw new StateFileError(
          "state-path-in-workdir",
          `Docker State path overlaps the workdir: ${JSON.stringify(resolved)}.`,
        );
      }
      if (!resolved.startsWith("/") || forbidden.some((path) => within(path, resolved) || within(resolved, path))) {
        throw new StateFileError(
          "state-path-conflict",
          `Docker State path overlaps a protected or mounted tree: ${JSON.stringify(resolved)}.`,
        );
      }
      roots.push({ declared, resolved, present: (await inspectPath(container, resolved, signal)) !== undefined });
    }
    const [first, ...rest] = roots;
    if (first === undefined) throw new Error("Docker State requires at least one root.");
    return { roots: [first, ...rest] };
  }

  return {
    resolve: async (paths, signal) => {
      let layout: StateManifest | undefined;
      const quiescent = await withQuiescence(signal, async () => {
        layout = await resolve(paths, signal);
      });
      if (!quiescent || layout === undefined) {
        throw new StateQuiescenceError("The Docker Sandbox has additional processes before State path validation.");
      }
      return layout;
    },
    withQuiescence,
    restore: async (manifest, chunks, signal) => {
      const quiescent = await withQuiescence(signal, async () => {
        const targets = await resolve(
          manifest.roots.map(({ declared }) => declared),
          signal,
        );
        for (const [ordinal, target] of targets.roots.entries()) {
          if (target.resolved !== manifest.roots[ordinal]?.resolved)
            throw new Error("Docker State restore path changed.");
          if (target.present) throw new StateRootPreexistingError(target.resolved);
        }
        await restoreArchive(input.container(), manifest, chunks, signal);
      });
      if (!quiescent)
        throw new StateQuiescenceError("The Docker Sandbox has additional processes before State restore.");
    },
    capture: async (expected, signal) => {
      const container = frozen;
      if (container === undefined) throw new StateQuiescenceError("Docker State capture requires a frozen Sandbox.");
      const manifest = await resolve(
        expected.roots.map(({ declared }) => declared),
        signal,
      );
      const inventory = await (changes ??= readChanges(container, signal));
      return {
        manifest,
        chunks: packedArchive(async (pack) => {
          for (const [ordinal, root] of manifest.roots.entries()) {
            await captureRoot(container, pack, root, ordinal, inventory, signal);
          }
        }),
      };
    },
  };
}
