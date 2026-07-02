import { posix } from "node:path";
import { isAbsolute, resolve } from "node:path";
import type { CommandOptions, Sandbox } from "../types.ts";

export function resolveSandboxPath(workdir: string, path?: string): string {
  if (!path || path === ".") return workdir;
  return path.startsWith("/") ? path : posix.join(workdir, path);
}

export function resolveLocalPath(baseDir: string | undefined, path: string): string {
  if (!baseDir || isAbsolute(path)) return path;
  return resolve(baseDir, path);
}

function resolveCommandOptions(workdir: string, opts: CommandOptions | undefined): CommandOptions | undefined {
  if (!opts?.cwd) return opts;
  return { ...opts, cwd: resolveSandboxPath(workdir, opts.cwd) };
}

export function normalizeSandboxPaths(sandbox: Sandbox): Sandbox {
  return {
    get workdir() {
      return sandbox.workdir;
    },
    get sandboxId() {
      return sandbox.sandboxId;
    },
    get otlpHost() {
      return sandbox.otlpHost;
    },
    runCommand: (cmd, args, opts) => sandbox.runCommand(cmd, args, resolveCommandOptions(sandbox.workdir, opts)),
    runShell: (script, opts) => sandbox.runShell(script, resolveCommandOptions(sandbox.workdir, opts)),
    readFile: (path) => sandbox.readFile(resolveSandboxPath(sandbox.workdir, path)),
    fileExists: (path) => sandbox.fileExists(resolveSandboxPath(sandbox.workdir, path)),
    readSourceFiles: (opts) => sandbox.readSourceFiles(opts),
    writeFiles: (files, targetDir) => sandbox.writeFiles(files, resolveSandboxPath(sandbox.workdir, targetDir)),
    uploadFiles: (files, targetDir) => sandbox.uploadFiles(files, resolveSandboxPath(sandbox.workdir, targetDir)),
    uploadDirectory: (localDir, targetDir, opts) =>
      sandbox.uploadDirectory(localDir, resolveSandboxPath(sandbox.workdir, targetDir), opts),
    stop: () => sandbox.stop(),
    appendLog: sandbox.appendLog ? (line) => sandbox.appendLog!(line) : undefined,
    downloadFile: (path) => sandbox.downloadFile(resolveSandboxPath(sandbox.workdir, path)),
    uploadFile: (path, content) => sandbox.uploadFile(resolveSandboxPath(sandbox.workdir, path), content),
  };
}
