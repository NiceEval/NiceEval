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
import { redactSensitiveText } from "./redaction.ts";

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
  let asRoot = false;
  try {
    await sandbox.runCommandOrThrow("rm", ["-rf", partsDir, mergedPath]);
    await sandbox.runCommandOrThrow("mkdir", ["-p", partsDir]);
  } catch (error) {
    if (!isPermissionDeniedCommand(error)) throw error;
    // A fixture may intentionally create the destination parent as root. Retry only a proven
    // permission denial with root; transport failures and deterministic non-permission exits must
    // retain their original identity and error.
    asRoot = true;
    await sandbox.runCommandOrThrow("rm", ["-rf", partsDir, mergedPath], { user: "root" });
    await sandbox.runCommandOrThrow("mkdir", ["-p", partsDir], { user: "root" });
  }
  let commandOptions = asRoot ? { user: "root" as const } : undefined;

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
    ], commandOptions);
    try {
      await sandbox.runCommandOrThrow("mv", ["-f", mergedPath, targetPath], commandOptions);
    } catch (error) {
      if (asRoot || !isPermissionDeniedCommand(error)) throw error;
      // In a sticky directory (for example /tmp), staging can be user-owned while an existing target
      // is root-owned and cannot be replaced. Escalate only that proven final replacement failure.
      asRoot = true;
      commandOptions = { user: "root" };
      await sandbox.runCommandOrThrow("mv", ["-f", mergedPath, targetPath], commandOptions);
    }
    await sandbox.runCommandOrThrow("rm", ["-rf", partsDir], commandOptions);
  } catch (error) {
    // Cleanup is best effort; never replace the provider error that explains
    // which part failed to transfer.
    await sandbox.runCommand("rm", ["-rf", partsDir, mergedPath], commandOptions).catch(() => undefined);
    throw error;
  }
}

function isPermissionDeniedCommand(error: unknown): error is SandboxCommandExitError {
  return error instanceof SandboxCommandExitError &&
    /permission denied|operation not permitted/i.test(`${error.result.stdout}\n${error.result.stderr}`);
}

/** `run*OrThrow` 的非零退出错误；transport、timeout 与取消错误不会被改写成它。 */
export class SandboxCommandExitError extends Error {
  readonly code = "command-exit";
  readonly result: CommandResult;

  constructor(result: CommandResult, sensitiveValues: readonly string[] = []) {
    const command = redactSensitiveText(result.command
      ? `sandbox command exited with code ${result.exitCode}: ${result.command}`
      : `sandbox command exited with code ${result.exitCode}`, sensitiveValues);
    const output = result.stderr.length > 0 ? result.stderr : result.stdout;
    const outputLabel = result.stderr.length > 0 ? "stderr" : "stdout";
    const tail = boundedCommandOutputTail(redactSensitiveText(output, sensitiveValues));
    super(tail.length > 0 ? `${command}; ${outputLabel} tail: ${tail}` : command);
    this.name = "SandboxCommandExitError";
    this.result = result;
  }
}

const COMMAND_ERROR_TAIL_MAX_CHARS = 240;

function boundedCommandOutputTail(text: string): string {
  const cleaned = text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= COMMAND_ERROR_TAIL_MAX_CHARS) return cleaned;
  return `…${cleaned.slice(-(COMMAND_ERROR_TAIL_MAX_CHARS - 1))}`;
}

export function successfulCommandResult(
  result: CommandResult,
  sensitiveValues: readonly string[] = [],
): SuccessfulCommandResult {
  if (result.exitCode !== 0) throw new SandboxCommandExitError(result, sensitiveValues);
  return result as SuccessfulCommandResult;
}

async function ensureContentDirectory(sandbox: SandboxOperations, path: string): Promise<void> {
  try {
    await sandbox.runCommandOrThrow("mkdir", ["-p", path]);
  } catch (error) {
    if (!isPermissionDeniedCommand(error)) throw error;

    // putContent is a host transfer primitive. Prefer the sandbox user so normal
    // workdir fixtures stay editable, but a caller may have prepared the target
    // parent as root immediately before transfer (for example under /tmp).
    await sandbox.runCommandOrThrow("mkdir", ["-p", path], { user: "root" });
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
