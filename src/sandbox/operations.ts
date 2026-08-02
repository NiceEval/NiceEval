// Sandbox 三个公开视图共用的 checked-command 与 layer target 适配。

import type {
  CommandResult,
  SandboxOperations,
  SuccessfulCommandResult,
} from "./types.ts";
import {
  registeredSandboxContentSnapshotOf,
  type RegisteredSandboxContent,
} from "./content.ts";

// Provider file APIs often impose a much shorter per-request deadline than the
// Attempt budget. Keep each write comfortably below that boundary, then replace
// the destination only after every part has arrived.
const PUT_CONTENT_CHUNK_BYTES = 8 * 1024 * 1024;

async function putContentBytes(
  sandbox: SandboxOperations,
  targetPath: string,
  bytes: Uint8Array,
  digest: string,
): Promise<void> {
  if (bytes.byteLength <= PUT_CONTENT_CHUNK_BYTES) {
    await sandbox.writeBytes(targetPath, bytes);
    return;
  }

  const suffix = digest.replace(/^sha256:/, "").slice(0, 16);
  const partsDir = `${targetPath}.niceeval-parts-${suffix}`;
  const mergedPath = `${targetPath}.niceeval-merge-${suffix}`;
  await sandbox.runCommandOrThrow("rm", ["-rf", partsDir, mergedPath]);
  await sandbox.runCommandOrThrow("mkdir", ["-p", partsDir]);

  try {
    let index = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += PUT_CONTENT_CHUNK_BYTES) {
      const part = `${partsDir}/part-${String(index).padStart(6, "0")}`;
      await sandbox.writeBytes(part, bytes.subarray(offset, offset + PUT_CONTENT_CHUNK_BYTES));
      index += 1;
    }
    await sandbox.runCommandOrThrow("sh", [
      "-c",
      'cat "$1"/part-* > "$2"',
      "niceeval-put-content",
      partsDir,
      mergedPath,
    ]);
    await sandbox.runCommandOrThrow("mv", ["-f", mergedPath, targetPath]);
    await sandbox.runCommandOrThrow("rm", ["-rf", partsDir]);
  } catch (error) {
    // Cleanup is best effort; never replace the provider error that explains
    // which part failed to transfer.
    await sandbox.runCommand("rm", ["-rf", partsDir, mergedPath]).catch(() => undefined);
    throw error;
  }
}

/** `run*OrThrow` 的非零退出错误；transport、timeout 与取消错误不会被改写成它。 */
export class SandboxCommandExitError extends Error {
  readonly code = "command-exit";
  readonly result: CommandResult;

  constructor(result: CommandResult) {
    super(
      result.command
        ? `sandbox command exited with code ${result.exitCode}: ${result.command}`
        : `sandbox command exited with code ${result.exitCode}`,
    );
    this.name = "SandboxCommandExitError";
    this.result = result;
  }
}

export function successfulCommandResult(result: CommandResult): SuccessfulCommandResult {
  if (result.exitCode !== 0) throw new SandboxCommandExitError(result);
  return result as SuccessfulCommandResult;
}

async function ensureContentDirectory(sandbox: SandboxOperations, path: string): Promise<void> {
  try {
    await sandbox.runCommandOrThrow("mkdir", ["-p", path]);
  } catch (error) {
    if (
      !(error instanceof SandboxCommandExitError) ||
      !/permission denied|operation not permitted/i.test(`${error.result.stdout}\n${error.result.stderr}`)
    ) {
      throw error;
    }

    // putContent is a host transfer primitive. Prefer the sandbox user so normal
    // workdir fixtures stay editable, but a caller may have prepared the target
    // parent as root immediately before transfer (for example under /tmp).
    await sandbox.runCommandOrThrow("mkdir", ["-p", path], { root: true });
  }
}

/** Layer callback 的窄视图；不带宿主传输、provider 元数据或生命周期方法。 */
export function createSandboxCommandTarget(
  sandbox: SandboxOperations,
): import("./commands.ts").SandboxCommandTarget {
  return {
    get workdir() {
      return sandbox.workdir;
    },
    runCommand: (command, args, options) => sandbox.runCommand(command, args, options),
    runShell: (script, options) => sandbox.runShell(script, options),
    runCommandOrThrow: (command, args, options) => sandbox.runCommandOrThrow(command, args, options),
    runShellOrThrow: (script, options) => sandbox.runShellOrThrow(script, options),
    readText: (path) => sandbox.readText(path),
    writeText: (path, content) => sandbox.writeText(path, content),
    readBytes: (path) => sandbox.readBytes(path),
    writeBytes: (path, content) => sandbox.writeBytes(path, content),
    pathExists: (path) => sandbox.pathExists(path),
    copyPath: async (sourcePath, targetPath) => {
      await sandbox.runCommandOrThrow("cp", ["-R", sourcePath, targetPath]);
    },
    putContent: async (content: RegisteredSandboxContent, targetPath: string) => {
      // 先完成 live source 复读、digest 校验和不可变快照，再发起任何 provider I/O。
      const snapshot = registeredSandboxContentSnapshotOf(content);
      if (snapshot.kind === "file") {
        await putContentBytes(
          sandbox,
          targetPath,
          Uint8Array.from(Buffer.from(snapshot.contentBase64, "base64")),
          snapshot.digest,
        );
        return;
      }

      await ensureContentDirectory(sandbox, targetPath);
      // Snapshot 已按路径稳定排序；这里仍显式顺序消费，禁止 Promise.all 引入 provider I/O 乱序。
      for (const entry of snapshot.entries) {
        const path = `${targetPath.replace(/\/$/, "")}/${entry.path}`;
        if (entry.kind === "directory") {
          await ensureContentDirectory(sandbox, path);
        } else {
          await putContentBytes(
            sandbox,
            path,
            Uint8Array.from(Buffer.from(entry.contentBase64, "base64")),
            snapshot.digest,
          );
        }
      }
    },
  };
}
