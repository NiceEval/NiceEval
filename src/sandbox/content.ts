// registerSandboxContent():在 discovery / planning 前把宿主内容收敛成 digest-backed handle。
// 真正的 host transfer 由后续 SandboxCommandTarget.putContent() 接线消费这里保存的内部 locator。

import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REGISTERED_SANDBOX_CONTENT: unique symbol = Symbol.for("niceeval.sandbox.content.registered");
const REGISTERED_SANDBOX_CONTENT_SOURCE: unique symbol = Symbol.for("niceeval.sandbox.content.source");

export interface RegisteredSandboxContent {
  readonly [REGISTERED_SANDBOX_CONTENT]: true;
  readonly digest: string;
  readonly kind: "file" | "directory";
}

export interface RegisteredSandboxContentSource {
  readonly path: string;
  readonly url: URL;
}

type RegisteredSandboxContentRuntime = RegisteredSandboxContent & {
  readonly [REGISTERED_SANDBOX_CONTENT_SOURCE]: RegisteredSandboxContentSource;
};

function isInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function resolveSource(source: string | URL): string {
  if (source instanceof URL) {
    if (source.protocol !== "file:") {
      throw new TypeError(`registerSandboxContent URL must use file:, got ${source.protocol}`);
    }
    return realpathSync(fileURLToPath(source));
  }
  if (typeof source !== "string" || source.trim() === "") {
    throw new TypeError("registerSandboxContent source must be a non-empty path or file URL");
  }
  if (isAbsolute(source)) return realpathSync(source);

  const projectRoot = realpathSync(process.cwd());
  const resolved = realpathSync(resolve(projectRoot, source));
  if (!isInside(projectRoot, resolved)) {
    throw new Error(
      `registerSandboxContent relative source must stay inside the project root ${projectRoot}; ` +
        `use an explicit file URL for external content (got ${source})`,
    );
  }
  return resolved;
}

function hashFile(path: string): string {
  const hash = createHash("sha256");
  hash.update("file\0");
  hash.update(readFileSync(path));
  return `sha256:${hash.digest("hex")}`;
}

function hashDirectory(root: string): string {
  const hash = createHash("sha256");
  hash.update("directory\0");

  const visit = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = resolve(directory, entry.name);
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const info = lstatSync(child);
      if (info.isDirectory()) {
        hash.update(`d\0${name}\0`);
        visit(child, name);
      } else if (info.isFile()) {
        hash.update(`f\0${name}\0`);
        hash.update(readFileSync(child));
        hash.update("\0");
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
  return `sha256:${hash.digest("hex")}`;
}

export function registerSandboxContent(source: string | URL): RegisteredSandboxContent {
  const path = resolveSource(source);
  const info = statSync(path);
  const kind = info.isFile() ? "file" : info.isDirectory() ? "directory" : undefined;
  if (kind === undefined) {
    throw new Error(`registerSandboxContent source must be a file or directory: ${path}`);
  }
  const digest = kind === "file" ? hashFile(path) : hashDirectory(path);
  const sourceInfo = Object.freeze({ path, url: pathToFileURL(path) });
  const content = { kind, digest } as RegisteredSandboxContentRuntime;
  Object.defineProperties(content, {
    [REGISTERED_SANDBOX_CONTENT]: { value: true },
    [REGISTERED_SANDBOX_CONTENT_SOURCE]: { value: sourceInfo },
  });
  return Object.freeze(content);
}

export function isRegisteredSandboxContent(value: unknown): value is RegisteredSandboxContent {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<RegisteredSandboxContent>;
  return (
    candidate[REGISTERED_SANDBOX_CONTENT] === true &&
    (candidate.kind === "file" || candidate.kind === "directory") &&
    typeof candidate.digest === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(candidate.digest)
  );
}

/** 仅供后续 transfer planning 使用，不从 niceeval/sandbox 公开。 */
export function registeredSandboxContentSourceOf(
  content: RegisteredSandboxContent,
): RegisteredSandboxContentSource {
  if (!isRegisteredSandboxContent(content)) {
    throw new TypeError("putContent requires a registerSandboxContent() handle");
  }
  const source = (content as RegisteredSandboxContentRuntime)[REGISTERED_SANDBOX_CONTENT_SOURCE];
  if (source === undefined) throw new TypeError("registered sandbox content is missing its source locator");
  return source;
}
