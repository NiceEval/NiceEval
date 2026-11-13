import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { digestBytes } from "./identity.ts";

const planningRoot = new AsyncLocalStorage<string>();

/** Project module loaders supply the real project boundary, including fresh generations. */
export function withSandboxScriptRoot<A>(root: string, load: () => A): A {
  return planningRoot.run(root, load);
}

export interface SandboxScriptSource {
  readonly path: string;
  readonly digest: string;
  readonly bytes: number;
}

function inside(root: string, path: string): boolean {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

/** Read once during planning; execution only receives the frozen decoded text. */
export function readSandboxScript(source: URL): { readonly command: string; readonly source: SandboxScriptSource } {
  let path = String(source);
  try {
    if (!(source instanceof URL) || source.protocol !== "file:" || source.search !== "" || source.hash !== "") {
      throw new TypeError("script must be a file: URL without query or fragment");
    }
    path = fileURLToPath(source);
    const root = realpathSync(planningRoot.getStore() ?? process.cwd());
    const physical = realpathSync(path);
    if (!inside(root, path) || !inside(root, physical)) throw new Error("script realpath must stay inside the project root");
    if (!statSync(physical).isFile()) throw new Error("script must be a regular text file");
    const bytes = readFileSync(physical);
    const command = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (command.includes("\0")) throw new Error("script must be UTF-8 text without NUL bytes");
    return Object.freeze({
      command,
      source: Object.freeze({ path: relative(root, path).split(sep).join("/"), digest: `sha256:${digestBytes(bytes)}`, bytes: bytes.length }),
    });
  } catch (cause) {
    throw new Error(`shell script ${JSON.stringify(path)}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}
