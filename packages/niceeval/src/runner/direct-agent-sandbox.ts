// Direct Agent 占位句柄与 Eval 本地路径适配；只实现当前 Sandbox 公共词汇。

import { inheritSandboxCapabilities } from "../sandbox/backend.ts";
import { resolveEvalLocalPath } from "../sandbox/paths.ts";
import type { Sandbox } from "../types.ts";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { frozenTransferContent } from "../sandbox/content.ts";
import { captureTransferInput, type StaticTransferPlan } from "./transfer-inputs.ts";

function directAgentUnavailable<T>(method: keyof Sandbox): Promise<T> {
  return Promise.reject(
    new Error(`Direct Agents do not have sandbox.${method}; use a Sandbox Agent or remove workspace assertions.`),
  );
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
    startCommand: () => directAgentUnavailable("startCommand"),
    startShell: () => directAgentUnavailable("startShell"),
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
  const view: Sandbox = {
    get workdir() {
      return sandbox.workdir;
    },
    get nativeInstanceId() {
      return sandbox.nativeInstanceId;
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
    startCommand: (command, args, options) => sandbox.startCommand(command, args, options),
    startShell: (script, options) => sandbox.startShell(script, options),
    readText: (path) => sandbox.readText(path),
    writeText: (path, content) => sandbox.writeText(path, content),
    readBytes: (path) => sandbox.readBytes(path),
    writeBytes: (path, content) => sandbox.writeBytes(path, content),
    pathExists: (path) => sandbox.pathExists(path),
    upload: (content, targetPath) => sandbox.upload(content, targetPath),
    uploadFile: (source, targetPath) => sandbox.uploadFile(resolveEvalLocalPath(baseDir, source), targetPath),
    uploadDirectory: (sourceDir, targetDir, options) =>
      sandbox.uploadDirectory(resolveEvalLocalPath(baseDir, sourceDir), targetDir, options),
    downloadFile: (sourcePath, target) => sandbox.downloadFile(sourcePath, resolveEvalLocalPath(baseDir, target)),
    downloadDirectory: (sourceDir, targetDir, options) =>
      sandbox.downloadDirectory(sourceDir, resolveEvalLocalPath(baseDir, targetDir), options),
    stop: () => sandbox.stop(),
    ...(appendLog === undefined ? {} : { appendLog: (line: string) => appendLog.call(sandbox, line) }),
  };
  inheritSandboxCapabilities(sandbox, view);
  return view;
}

/** Only the Eval test receives this view; Agent/Plugin paths keep their own owner. */
export function createEvalSandboxView(
  sandbox: Sandbox,
  baseDir: string,
  options: {
    readonly ownerRoot: string;
    readonly plans: readonly StaticTransferPlan[] | undefined;
    readonly sendOrdinal: () => number;
  },
): { readonly sandbox: Sandbox; readonly complete: () => void } {
  const local = withEvalLocalPaths(sandbox, baseDir);
  let index = 0;
  const upload = async (
    operation: StaticTransferPlan["operation"],
    source: string | URL,
    target: string | undefined,
    ignore: readonly string[],
  ): Promise<void> => {
    const resolved = resolveEvalLocalPath(baseDir, source);
    const path = resolve(typeof resolved === "string" ? resolved : fileURLToPath(resolved));
    const root = realpathSync(options.ownerRoot);
    const child = relative(root, realpathSync(path));
    if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error("Eval transfer resolves outside its owner");
    }
    if (options.plans === undefined) {
      if (operation === "uploadFile") return local.uploadFile(source, target!);
      return local.uploadDirectory(source, target, { ignore });
    }
    const plan = options.plans[index];
    if (
      plan === undefined ||
      plan.operation !== operation ||
      resolve(plan.source) !== path ||
      plan.target !== target ||
      plan.sendOrdinal !== options.sendOrdinal() ||
      JSON.stringify(plan.ignore) !== JSON.stringify(ignore)
    ) {
      throw new Error("Eval transfer does not match its frozen static plan");
    }
    const snapshot = captureTransferInput(operation, path, ignore);
    if (snapshot.digest !== plan.contentIdentity) throw new Error("Eval transfer content changed after planning");
    // Provider retries receive the captured bytes/tree, never the live locator.
    // Ordinary uploadFile writes bytes without changing the target's mode.
    if (snapshot.kind === "file") {
      await sandbox.writeBytes(target!, Uint8Array.from(Buffer.from(snapshot.contentBase64, "base64")));
    } else {
      await sandbox.upload(frozenTransferContent(snapshot), target ?? sandbox.workdir);
    }
    index++;
  };
  const view = new Proxy(local, {
    get(target, key, receiver) {
      if (key === "uploadFile")
        return (source: string | URL, targetPath: string) => upload("uploadFile", source, targetPath, []);
      if (key === "uploadDirectory")
        return (source: string | URL, targetPath?: string, opts?: { readonly ignore?: readonly string[] }) =>
          upload("uploadDirectory", source, targetPath, opts?.ignore ?? []);
      return Reflect.get(target, key, receiver);
    },
  });
  inheritSandboxCapabilities(sandbox, view);
  return {
    sandbox: view,
    complete: () => {
      if (options.plans !== undefined && index !== options.plans.length)
        throw new Error("Eval did not complete its frozen transfer plan");
    },
  };
}
