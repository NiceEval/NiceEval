// Direct Agent 占位句柄与 Eval 本地路径适配；只实现当前 Sandbox 公共词汇。

import { resolveEvalLocalPath } from "../sandbox/paths.ts";
import type { Sandbox } from "../types.ts";
import { t } from "../i18n/index.ts";

function directAgentUnavailable<T>(method: keyof Sandbox): Promise<T> {
  return Promise.reject(new Error(t("runner.directAgentSandboxUnavailable", { method })));
}

/** Direct Agent 没有运行中 Sandbox；除固定清理 stop 外，首次调用即点名具体 API。 */
export function createDirectAgentSandbox(): Sandbox {
  return {
    workdir: "",
    sandboxId: "direct-agent",
    otlpHost: "127.0.0.1",
    runCommand: () => directAgentUnavailable("runCommand"),
    runShell: () => directAgentUnavailable("runShell"),
    runCommandOrThrow: () => directAgentUnavailable("runCommandOrThrow"),
    runShellOrThrow: () => directAgentUnavailable("runShellOrThrow"),
    readText: () => directAgentUnavailable("readText"),
    writeText: () => directAgentUnavailable("writeText"),
    readBytes: () => directAgentUnavailable("readBytes"),
    writeBytes: () => directAgentUnavailable("writeBytes"),
    pathExists: () => directAgentUnavailable("pathExists"),
    upload: () => directAgentUnavailable("upload"),
    uploadFile: () => directAgentUnavailable("uploadFile"),
    uploadDirectory: () => directAgentUnavailable("uploadDirectory"),
    downloadFile: () => directAgentUnavailable("downloadFile"),
    downloadDirectory: () => directAgentUnavailable("downloadDirectory"),
    // stop 是调度器固定清理路径；Direct Agent 没有资源需要释放。
    stop: async () => {},
  };
}

/** Eval 宿主相对路径以定义文件目录为锚；URL 保持其精确文件位置。 */
export function withEvalLocalPaths(sandbox: Sandbox, baseDir: string): Sandbox {
  const appendLog = sandbox.appendLog;
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
    runCommand: (command, args, options) => sandbox.runCommand(command, args, options),
    runShell: (script, options) => sandbox.runShell(script, options),
    runCommandOrThrow: (command, args, options) => sandbox.runCommandOrThrow(command, args, options),
    runShellOrThrow: (script, options) => sandbox.runShellOrThrow(script, options),
    readText: (path) => sandbox.readText(path),
    writeText: (path, content) => sandbox.writeText(path, content),
    readBytes: (path) => sandbox.readBytes(path),
    writeBytes: (path, content) => sandbox.writeBytes(path, content),
    pathExists: (path) => sandbox.pathExists(path),
    upload: (content, targetPath) => sandbox.upload(content, targetPath),
    uploadFile: (source, targetPath) =>
      sandbox.uploadFile(resolveEvalLocalPath(baseDir, source), targetPath),
    uploadDirectory: (sourceDir, targetDir, options) =>
      sandbox.uploadDirectory(resolveEvalLocalPath(baseDir, sourceDir), targetDir, options),
    downloadFile: (sourcePath, target) =>
      sandbox.downloadFile(sourcePath, resolveEvalLocalPath(baseDir, target)),
    downloadDirectory: (sourceDir, targetDir, options) =>
      sandbox.downloadDirectory(sourceDir, resolveEvalLocalPath(baseDir, targetDir), options),
    stop: () => sandbox.stop(),
    ...(appendLog === undefined ? {} : { appendLog: (line: string) => appendLog.call(sandbox, line) }),
  };
}
