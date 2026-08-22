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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTERED_SANDBOX_CONTENT: unique symbol = Symbol("niceeval.sandbox.content.registered");
const REGISTERED_CONTENTS = new WeakSet<object>();
const REGISTERED_CONTENT_LOCATORS = new WeakMap<object, { readonly path: string }>();

export interface RegisteredSandboxContent {
  readonly [REGISTERED_SANDBOX_CONTENT]: true;
  readonly digest: string;
  readonly kind: "file" | "directory";
}

export type RegisteredSandboxDirectoryEntry =
  | { readonly kind: "directory"; readonly path: string }
  | { readonly kind: "file"; readonly path: string; readonly contentBase64: string };

/**
 * Provider I/O 前取得的内容快照。字符串 payload 不可变，上传实现不会在校验后再回头读 live path。
 */
export type RegisteredSandboxContentSnapshot =
  | {
      readonly kind: "file";
      readonly digest: string;
      readonly contentBase64: string;
    }
  | {
      readonly kind: "directory";
      readonly digest: string;
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

function digestFile(bytes: Buffer): string {
  const hash = createHash("sha256");
  hash.update("file\0");
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

function captureFile(path: string): RegisteredSandboxContentSnapshot {
  const bytes = readFileSync(path);
  return Object.freeze({
    kind: "file" as const,
    digest: digestFile(bytes),
    contentBase64: bytes.toString("base64"),
  });
}

function captureDirectory(root: string): RegisteredSandboxContentSnapshot {
  const hash = createHash("sha256");
  hash.update("directory\0");
  const captured: RegisteredSandboxDirectoryEntry[] = [];

  const visit = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = resolve(directory, entry.name);
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const info = lstatSync(child);
      if (info.isDirectory()) {
        hash.update(`d\0${name}\0`);
        captured.push(Object.freeze({ kind: "directory", path: name }));
        visit(child, name);
      } else if (info.isFile()) {
        const bytes = readFileSync(child);
        hash.update(`f\0${name}\0`);
        hash.update(bytes);
        hash.update("\0");
        captured.push(Object.freeze({ kind: "file", path: name, contentBase64: bytes.toString("base64") }));
      } else if (info.isSymbolicLink()) {
        const target = readlinkSync(child);
        throw new Error(
          `registerSandboxContent directory contains symbolic link ${child} -> ${target}; ` +
            "replace it with regular content or register the resolved target explicitly",
        );
      } else {
        throw new Error(`registerSandboxContent does not support special filesystem entry ${child}`);
      }
    }
  };

  visit(root, "");
  return Object.freeze({
    kind: "directory" as const,
    digest: `sha256:${hash.digest("hex")}`,
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
  if (info.isFile()) return captureFile(physical);
  if (info.isDirectory()) return captureDirectory(physical);
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
