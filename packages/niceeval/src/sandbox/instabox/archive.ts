import * as tar from "tar-stream";
import { randomUUID } from "node:crypto";
import { chmod, cp, lstat, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { RegisteredSandboxContentSnapshot } from "../content.ts";

export type DirectorySnapshot = Extract<RegisteredSandboxContentSnapshot, { kind: "directory" }>;

export async function directoryArchive(snapshot: DirectorySnapshot): Promise<Uint8Array> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const consumed = (async () => { for await (const chunk of pack) chunks.push(Buffer.from(chunk as Uint8Array)); })();
  const entry = (header: Partial<tar.Header> & Pick<tar.Header, "name">, bytes: Buffer = Buffer.alloc(0)) => new Promise<void>((resolve, reject) => {
    pack.entry(header, bytes, (error) => error ? reject(error) : resolve());
  });
  await entry({ name: ".", type: "directory", mode: snapshot.mode });
  for (const item of snapshot.entries) {
    if (item.kind === "file") await entry({ name: item.path, mode: item.mode }, Buffer.from(item.contentBase64, "base64"));
    else if (item.kind === "directory") await entry({ name: item.path, type: "directory", mode: item.mode });
    else await entry({ name: item.path, type: "symlink", linkname: item.target, mode: 0o777 });
  }
  pack.finalize();
  await consumed;
  return Buffer.concat(chunks);
}

// Extract into a sibling first. No destination is replaced until tar has exited
// successfully. Existing content is merged, but never followed through symlinks.
export const expandDirectory = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const c = JSON.parse(Buffer.from(process.argv[1], 'base64'));
const parent = path.dirname(c.target), stage = c.target + '.stage-' + c.id, backup = c.target + '.backup-' + c.id;
let moved = false, installed = false;
try {
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(c.target)) {
    if (!fs.lstatSync(c.target).isDirectory() || fs.lstatSync(c.target).isSymbolicLink()) throw Error('Directory target must be a real directory');
    fs.cpSync(c.target, stage, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    fs.chmodSync(stage, fs.statSync(stage).mode | 0700);
  } else fs.mkdirSync(stage);
  for (const entry of c.entries) {
    const parts = entry.path.split('/');
    let current = stage;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      let info; try { info = fs.lstatSync(current); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (info && (i < parts.length - 1 || entry.kind === 'directory')) {
        if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Archive directory collides with a non-directory');
        fs.chmodSync(current, info.mode | 0700);
      } else if (info) fs.rmSync(current, { recursive: true, force: true });
    }
  }
  const result = spawnSync('tar', ['-xpf', c.archive, '--no-same-owner', '-C', stage], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Directory archive expansion failed');
  if (fs.existsSync(c.target)) { fs.renameSync(c.target, backup); moved = true; }
  fs.renameSync(stage, c.target); installed = true;
} finally {
  if (moved && !installed) fs.renameSync(backup, c.target);
  fs.rmSync(stage, { recursive: true, force: true });
  if (installed) fs.rmSync(backup, { recursive: true, force: true });
  fs.rmSync(c.archive, { force: true });
}
`;

function safePath(root: string, name: string): string {
  if (name.includes("\0") || isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error("Unsafe directory archive path");
  const target = resolve(root, name);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Directory archive escapes its root");
  return target;
}

export async function extractDirectory(bytes: Uint8Array, destination: string, ignore: readonly string[]): Promise<void> {
  const target = resolve(destination), id = randomUUID();
  const stage = `${target}.stage-${id}`, backup = `${target}.backup-${id}`;
  const extract = tar.extract();
  let moved = false, installed = false;
  const modes: Array<{ path: string; mode: number }> = [];
  try {
    await mkdir(dirname(target), { recursive: true });
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error("Directory destination must be a real directory");
      await cp(target, stage, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
      await chmod(stage, existing.mode | 0o700);
    } else await mkdir(stage);
    const consume = (async () => {
      for await (const stream of extract) {
        const header = stream.header;
        const name = header.name.replace(/^\.\//, "").replace(/\/$/, "");
        const path = safePath(stage, name);
        if (name.split("/").some(part => ignore.includes(part))) { for await (const _ of stream) { /* drain ignored bytes */ } continue; }
        const parts = name.split("/").filter(part => part !== "." && part !== "");
        let parent = stage;
        for (const part of parts.slice(0, -1)) {
          parent = resolve(parent, part);
          const info = await lstat(parent).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
          if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("Directory archive encounters a symlink parent");
          await mkdir(parent, { recursive: true });
        }
        if (header.type === "directory") {
          const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
          if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("Directory archive collides with a non-directory");
          await mkdir(path, { recursive: true });
          await chmod(path, (header.mode ?? 0o755) | 0o700);
          modes.push({ path, mode: (header.mode ?? 0o755) & 0o777 });
          for await (const _ of stream) { /* drain */ }
        } else if (header.type === "file" || header.type === "symlink") {
          if (path === stage) throw new Error("Archive root must be a directory");
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
          await rm(path, { force: true, recursive: true });
          if (header.type === "symlink") {
            if (!header.linkname || isAbsolute(header.linkname)) throw new Error("Unsafe archive symlink");
            const linked = resolve(dirname(path), header.linkname);
            if (linked !== stage && !linked.startsWith(`${stage}${sep}`)) throw new Error("Archive symlink escapes its root");
            await symlink(header.linkname, path);
          } else {
            await writeFile(path, Buffer.concat(chunks), { mode: (header.mode ?? 0o644) & 0o777 });
          }
        } else throw new Error(`Unsupported directory archive entry: ${header.type}`);
      }
    })();
    void consume.catch(() => extract.destroy());
    extract.end(bytes);
    await consume;
    for (const item of modes.reverse()) await chmod(item.path, item.mode);
    if (existing) { await rename(target, backup); moved = true; }
    await rename(stage, target); installed = true;
  } finally {
    if (moved && !installed) await rename(backup, target);
    await rm(stage, { recursive: true, force: true });
    if (installed) await rm(backup, { recursive: true, force: true });
  }
}
