// registerSandboxContent():在 discovery / planning 前把宿主内容收敛成 digest-backed handle。
// Handle 不公开 live path；后续 putContent() 必须先取得本模块校验后的不可变 snapshot。

import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTERED_SANDBOX_CONTENT: unique symbol = Symbol("niceeval.sandbox.content.registered");
const REGISTERED_CONTENTS = new WeakSet<object>();
const REGISTERED_CONTENT_LOCATORS = new WeakMap<object, { readonly path: string }>();

export interface RegisteredSandboxContent {
  readonly [REGISTERED_SANDBOX_CONTENT]: true;
  readonly digest: string;
  readonly kind: "file" | "directory";
}

/** Public name for an immutable, digest-backed host payload. */
export type SandboxContent = RegisteredSandboxContent;

export interface SandboxContentFactory {
  file(source: URL): SandboxContent;
  directory(source: URL): SandboxContent;
}

export type RegisteredSandboxDirectoryEntry =
  | { readonly kind: "directory"; readonly path: string; readonly mode: number }
  | { readonly kind: "file"; readonly path: string; readonly mode: number; readonly contentBase64: string }
  | { readonly kind: "symlink"; readonly path: string; readonly target: string };

/**
 * Provider I/O 前取得的内容快照。字符串 payload 不可变，上传实现不会在校验后再回头读 live path。
 */
export type RegisteredSandboxContentSnapshot =
  | {
      readonly kind: "file";
      readonly digest: string;
      readonly mode: number;
      readonly contentBase64: string;
    }
  | {
      readonly kind: "directory";
      readonly digest: string;
      readonly mode: number;
      readonly entries: readonly RegisteredSandboxDirectoryEntry[];
    };

function fileUrl(value: string | URL, path: string): URL {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new TypeError(`${path} must be a file URL such as import.meta.url`);
  }
  if (url.protocol !== "file:") throw new TypeError(`${path} must use file:, got ${url.protocol}`);
  return url;
}

function resolveSource(source: string | URL, definitionUrl?: string | URL): string {
  if (source instanceof URL) {
    if (definitionUrl !== undefined) {
      throw new TypeError("registerSandboxContent(URL) does not accept a second definition URL");
    }
    return resolve(fileURLToPath(fileUrl(source, "registerSandboxContent source")));
  }
  if (typeof source !== "string" || source.trim() === "") {
    throw new TypeError("registerSandboxContent source must be a non-empty path or file URL");
  }
  if (definitionUrl === undefined) {
    throw new TypeError(
      "registerSandboxContent string paths require the Eval definition URL; " +
        "call registerSandboxContent(path, import.meta.url) or pass new URL(path, import.meta.url)",
    );
  }
  const definitionPath = fileURLToPath(fileUrl(definitionUrl, "registerSandboxContent definitionUrl"));
  return resolve(dirname(definitionPath), source);
}

function permissionMode(mode: number): number {
  return mode & 0o777;
}

function digestFile(bytes: Buffer, mode: number): string {
  const hash = createHash("sha256");
  hash.update("file\0");
  hash.update(`${mode.toString(8)}\0`);
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

function captureFile(path: string, mode: number): RegisteredSandboxContentSnapshot {
  const bytes = readFileSync(path);
  return Object.freeze({
    kind: "file" as const,
    digest: digestFile(bytes, mode),
    mode,
    contentBase64: bytes.toString("base64"),
  });
}

function captureDirectory(root: string, rootMode: number): RegisteredSandboxContentSnapshot {
  const hash = createHash("sha256");
  hash.update("directory\0");
  hash.update(`root\0${rootMode.toString(8)}\0`);
  const captured: RegisteredSandboxDirectoryEntry[] = [];

  const visit = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = resolve(directory, entry.name);
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const info = lstatSync(child);
      if (info.isDirectory()) {
        const mode = permissionMode(info.mode);
        hash.update(`d\0${name}\0${mode.toString(8)}\0`);
        captured.push(Object.freeze({ kind: "directory", path: name, mode }));
        visit(child, name);
      } else if (info.isFile()) {
        const bytes = readFileSync(child);
        const mode = permissionMode(info.mode);
        hash.update(`f\0${name}\0${mode.toString(8)}\0`);
        hash.update(bytes);
        hash.update("\0");
        captured.push(Object.freeze({ kind: "file", path: name, mode, contentBase64: bytes.toString("base64") }));
      } else if (info.isSymbolicLink()) {
        const target = readlinkSync(child);
        const resolvedTarget = resolve(dirname(child), target);
        const targetFromRoot = relative(root, resolvedTarget);
        if (
          isAbsolute(target) ||
          targetFromRoot === ".." ||
          targetFromRoot.startsWith(`..${sep}`) ||
          isAbsolute(targetFromRoot)
        ) {
          throw new Error(
            `registerSandboxContent directory contains symbolic link outside its root: ${child} -> ${target}`,
          );
        }
        hash.update(`l\0${name}\0${target}\0`);
        captured.push(Object.freeze({ kind: "symlink", path: name, target }));
      } else {
        throw new Error(`registerSandboxContent does not support special filesystem entry ${child}`);
      }
    }
  };

  visit(root, "");
  return Object.freeze({
    kind: "directory" as const,
    digest: `sha256:${hash.digest("hex")}`,
    mode: rootMode,
    entries: Object.freeze(captured),
  });
}

function captureSource(path: string): RegisteredSandboxContentSnapshot {
  const lexical = lstatSync(path);
  if (lexical.isSymbolicLink()) {
    throw new Error(
      `registerSandboxContent source is a symbolic link ${path} -> ${readlinkSync(path)}; ` +
        "register the resolved target explicitly",
    );
  }
  const physical = realpathSync(path);
  const info = statSync(physical);
  const mode = permissionMode(info.mode);
  if (info.isFile()) return captureFile(physical, mode);
  if (info.isDirectory()) return captureDirectory(physical, mode);
  throw new Error(`registerSandboxContent source must be a file or directory: ${path}`);
}

export function registerSandboxContent(source: URL): RegisteredSandboxContent;
export function registerSandboxContent(source: string, definitionUrl: string | URL): RegisteredSandboxContent;
export function registerSandboxContent(
  source: string | URL,
  definitionUrl?: string | URL,
): RegisteredSandboxContent {
  const path = resolveSource(source, definitionUrl);
  const snapshot = captureSource(path);
  const content = { kind: snapshot.kind, digest: snapshot.digest } as RegisteredSandboxContent;
  Object.defineProperty(content, REGISTERED_SANDBOX_CONTENT, { value: true });
  REGISTERED_CONTENTS.add(content);
  REGISTERED_CONTENT_LOCATORS.set(content, Object.freeze({ path }));
  return Object.freeze(content);
}

function registerSandboxContentKind(
  expected: RegisteredSandboxContent["kind"],
  source: string | URL,
  definitionUrl?: string | URL,
): SandboxContent {
  const content = source instanceof URL
    ? registerSandboxContent(source)
    : registerSandboxContent(source, definitionUrl as string | URL);
  if (content.kind !== expected) {
    throw new TypeError(
      `sandboxContent.${expected === "file" ? "file" : "directory"}() expected ${expected} content, ` +
        `but the registered source is a ${content.kind}`,
    );
  }
  return content;
}

/**
 * Register fixed host content without transferring it. The returned handle may be used by an
 * action before the Agent or by `t.sandbox.upload()` later without exposing its live host path.
 */
export const sandboxContent: SandboxContentFactory = Object.freeze({
  file: (source: URL) => registerSandboxContentKind("file", source),
  directory: (source: URL) => registerSandboxContentKind("directory", source),
});

export function isRegisteredSandboxContent(value: unknown): value is RegisteredSandboxContent {
  if (value === null || typeof value !== "object" || !REGISTERED_CONTENTS.has(value)) return false;
  const candidate = value as Partial<RegisteredSandboxContent>;
  return (
    candidate[REGISTERED_SANDBOX_CONTENT] === true &&
    (candidate.kind === "file" || candidate.kind === "directory") &&
    typeof candidate.digest === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(candidate.digest)
  );
}

/**
 * 仅供后续 putContent transfer wrapper 使用，不从 niceeval/sandbox 公开。
 * 复读 live source、用将要上传的同一批字节复算 digest；变化在任何 Provider I/O 前失败。
 */
export function registeredSandboxContentSnapshotOf(
  content: RegisteredSandboxContent,
): RegisteredSandboxContentSnapshot {
  if (!isRegisteredSandboxContent(content)) {
    throw new TypeError("putContent requires a registerSandboxContent() handle");
  }
  const locator = REGISTERED_CONTENT_LOCATORS.get(content);
  if (locator === undefined) throw new TypeError("registered sandbox content is missing its private locator");
  let snapshot: RegisteredSandboxContentSnapshot;
  try {
    snapshot = captureSource(locator.path);
  } catch (error) {
    throw new Error(
      `registered sandbox content became unreadable before transfer (${content.digest}): ${String(error)}`,
      { cause: error },
    );
  }
  if (snapshot.kind !== content.kind || snapshot.digest !== content.digest) {
    throw new Error(
      `registered sandbox content changed before transfer: expected ${content.kind} ${content.digest}, ` +
        `got ${snapshot.kind} ${snapshot.digest}. Register the content again after the final write.`,
    );
  }
  return snapshot;
}
