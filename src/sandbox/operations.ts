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
        await sandbox.writeBytes(targetPath, Uint8Array.from(Buffer.from(snapshot.contentBase64, "base64")));
        return;
      }

      await sandbox.runCommandOrThrow("mkdir", ["-p", targetPath]);
      // Snapshot 已按路径稳定排序；这里仍显式顺序消费，禁止 Promise.all 引入 provider I/O 乱序。
      for (const entry of snapshot.entries) {
        const path = `${targetPath.replace(/\/$/, "")}/${entry.path}`;
        if (entry.kind === "directory") {
          await sandbox.runCommandOrThrow("mkdir", ["-p", path]);
        } else {
          await sandbox.writeBytes(path, Uint8Array.from(Buffer.from(entry.contentBase64, "base64")));
        }
      }
    },
  };
}
