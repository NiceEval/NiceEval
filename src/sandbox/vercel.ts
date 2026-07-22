// Vercel Sandbox provider:用 @vercel/sandbox SDK 把 Vercel microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox 可互换。

import { Sandbox as VSandbox, APIError } from "@vercel/sandbox";
import type { Sandbox, CommandResult, CommandOptions, SandboxFile } from "../types.ts";
import { downloadDirectoryByList } from "./download-directory.ts";
import { collectLocalFiles } from "./local-files.ts";
import { resolveSandboxPath } from "./paths.ts";
import { t } from "../i18n/index.ts";
import { reportActivity, reportDiagnostic } from "../runner/feedback/sink.ts";
import { classifyProvisionErrorFallback, type SandboxProvisionErrorKind } from "./errors.ts";

/**
 * vercel SDK 对单次 fetch 的 429 已有内部重试(见 @vercel/sandbox 的 with-retry.js,
 * 5 次指数退避);这里再分类是为了给 create() 整体重试兜底——耗尽内部重试后仍返回 429
 * 响应的 APIError,或 create() 轮询 session 状态过程里撞到的限流,都会走到这里。
 */
export function classifyProvisionError(e: unknown): SandboxProvisionErrorKind {
  if (e instanceof APIError && e.response.status === 429) return "rate_limit";
  // SDK 没有按元数据检索实例的通道:歧义类不重试、第一次抛出(见 retry.ts 的 reconcile 语义)。
  return classifyProvisionErrorFallback(e);
}

// Vercel Sandbox 的默认工作区路径(SDK writeFiles 默认落这里)。
const VERCEL_WORKDIR = "/vercel/sandbox";

// 单条命令的默认超时:设为沙箱 session 生命周期(10 分钟),防止长时间 build/install 被截断。
const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
// Rotate session when it has been alive >270s to stay under the plan cap (~360-390s).
const ROTATE_THRESHOLD_MS = 270_000;
const SESSION_TIMEOUT_MS = 1_200_000;
// rotate 时停掉旧 session 的等待上限:stop 挂起时不无限拖住当前命令。
const STOP_OLD_SESSION_TIMEOUT_MS = 15_000;

/** 给 promise 套超时;到点 reject,并清掉计时器避免拖住事件循环。 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class VercelSandbox implements Sandbox {
  readonly workdir = VERCEL_WORKDIR;
  readonly otlpHost = null;
  private vsb: InstanceType<typeof VSandbox>;
  private commandTimeoutMs: number;
  private sessionCreatedAt: number;
  private runtime: string;
  readonly sandboxId: string;

  private constructor(vsb: InstanceType<typeof VSandbox>, id: string, commandTimeoutMs: number, runtime: string) {
    this.vsb = vsb;
    this.sandboxId = id;
    this.commandTimeoutMs = commandTimeoutMs;
    this.sessionCreatedAt = Date.now();
    this.runtime = runtime;
  }

  static async create(
    opts: { timeout?: number; runtime?: "node20" | "node24"; snapshotId?: string; feedback?: import("../types.ts").ScopedFeedback } = {},
  ): Promise<VercelSandbox> {
    // Vercel 支持 node22/node24/node26/python3.13;node20 回退到 node22。
    const runtime = opts.runtime === "node20" ? "node22" : (opts.runtime ?? "node24");
    const commandTimeoutMs = opts.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS;

    // 凭据:优先从 env 显式传入(绕过 OIDC flow,非 TTY 环境也能用)。
    // 需要同时设 VERCEL_API_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID 三个。
    const token = process.env.VERCEL_API_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    const projectId = process.env.VERCEL_PROJECT_ID ?? "vercel-sandbox-default-project";
    const credParams = token && teamId ? { token, teamId, projectId } : {};

    // 给了 snapshotId 就从快照起 microVM(预制模板:烘焙好 agent CLI 的快照)。
    const sourceParams = opts.snapshotId ? { source: { type: "snapshot", snapshotId: opts.snapshotId } } : {};

    // session timeout 固定为 1200000ms (20 min)。不随 commandTimeoutMs 放大:
    // 实测发现超大的 timeout 值(>1200s)会导致 Vercel 返回实际更短的 session。
    // 1200000ms 是经验证能跑完 ~355s eval 的上限。
    const vsb = await VSandbox.create({ runtime, timeout: SESSION_TIMEOUT_MS, ...sourceParams, ...credParams } as Parameters<typeof VSandbox.create>[0]);
    // sandboxId = 沙箱的持久 name(留存唤醒的查找键),不是当前 session 的 sessionId——
    // session 在 rotate / stop-resume 之间会变,name 才是 `Sandbox.get({ name })` 能找回的
    // 稳定身份(SDK 与官方文档都按 name 索引,见 vercel.com/docs/sandbox/cli-reference)。
    const id = vsb.name;
    return new VercelSandbox(vsb, id, commandTimeoutMs, runtime);
  }

  // 当 session 存活超过 ROTATE_THRESHOLD_MS 时，拍快照并换用新 session。
  // 这绕过了 Vercel plan 对 extendTimeout 的限制(始终返回 HTTP 400)。
  private async rotateIfNeeded(): Promise<void> {
    const elapsed = Date.now() - this.sessionCreatedAt;
    if (elapsed < ROTATE_THRESHOLD_MS) return;

    const token = process.env.VERCEL_API_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    const projectId = process.env.VERCEL_PROJECT_ID ?? "vercel-sandbox-default-project";
    const credParams = token && teamId ? { token, teamId, projectId } : {};

    try {
      const snap = await this.vsb.snapshot();
      const snapshotId = snap.snapshotId;
      const newVsb = await VSandbox.create({
        runtime: this.runtime,
        timeout: SESSION_TIMEOUT_MS,
        source: { type: "snapshot", snapshotId },
        ...credParams,
      } as Parameters<typeof VSandbox.create>[0]);
      const oldVsb = this.vsb;
      this.vsb = newVsb;
      this.sessionCreatedAt = Date.now();
      // 旧 session 的 microVM 不随快照 / 新 session 创建自动回收,必须显式 stop,否则每次
      // rotate 都泄漏一台在计费的 microVM。stop 与新 session 无数据依赖,不 await ——
      // 挂起的 stop(最长 15s)不该拖住触发 rotate 的那条命令,还烧新 session 的时长。
      // 失败只警告不静默(旧的到 session timeout 也会被平台回收)。
      void withTimeout(oldVsb.stop(), STOP_OLD_SESSION_TIMEOUT_MS).catch((stopErr) => {
        reportDiagnostic({
          key: "vercel-stop-rotated-session-failed",
          severity: "warning",
          message: `[VercelSandbox] warning: failed to stop rotated-out session, microVM may leak until session timeout: ${String(stopErr)}`,
          data: { sandboxId: this.sandboxId, error: String(stopErr) },
        });
      });
      reportActivity(
        t("vercel.rotated", {
          seconds: Math.round(elapsed / 1000),
          sessionId: newVsb.currentSession().sessionId,
        }).trimEnd(),
      );
    } catch (err) {
      reportDiagnostic({
        key: "vercel-rotate-failed",
        severity: "warning",
        message: t("vercel.rotateFailed", {
          seconds: Math.round(elapsed / 1000),
          error: String(err),
        }).trimEnd(),
        data: { sandboxId: this.sandboxId, error: String(err) },
      });
    }
  }

  async runCommand(cmd: string, args: string[] = [], opts: CommandOptions = {}): Promise<CommandResult> {
    await this.rotateIfNeeded();
    const finished = await this.vsb.runCommand({
      cmd,
      args,
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      env: opts.env,
      sudo: opts.root ?? false,
      // 显式设 per-command timeout 防止长跑命令(npm build/install)被流截断。
      timeoutMs: this.commandTimeoutMs,
    });
    const stdout = await finished.stdout();
    const stderr = await finished.stderr();
    // Vercel SDK 的命令 API 只在结束后给完整输出；仍兑现 CommandOptions 回调的
    // 「至少一次」语义，让 adapter 不必按 provider 分叉。
    if (stdout) await opts.onStdout?.(stdout);
    if (stderr) await opts.onStderr?.(stderr);
    return {
      stdout,
      stderr,
      exitCode: finished.exitCode,
    };
  }

  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    return this.runCommand("bash", ["-c", script], opts);
  }

  async readFile(path: string): Promise<string> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const buf = await this.vsb.readFileToBuffer({ path: absPath });
    if (!buf) throw new Error(t("vercel.fileNotFound", { path: absPath }));
    return buf.toString("utf8");
  }

  async fileExists(path: string): Promise<boolean> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const buf = await this.vsb.readFileToBuffer({ path: absPath });
    return buf !== null;
  }

  // targetDir 已由 paths.ts 的 normalizeSandboxPaths 解析成绝对路径;这里再解析一次
  // 只是对直接使用 provider 实例(未包 normalize)的幂等防御,提到 map 外只算一次。
  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    const base = resolveSandboxPath(this.workdir, targetDir);
    const entries = Object.entries(files).map(([p, content]) => ({
      path: resolveSandboxPath(base, p),
      content,
    }));
    if (entries.length === 0) return;
    await this.vsb.writeFiles(entries);
  }

  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    if (files.length === 0) return;
    const base = resolveSandboxPath(this.workdir, targetDir);
    await this.vsb.writeFiles(
      files.map((f) => ({
        path: resolveSandboxPath(base, f.path),
        content: f.content,
      })),
    );
  }

  async uploadDirectory(localDir: string, targetDir?: string, opts: { ignore?: string[] } = {}): Promise<void> {
    await this.uploadFiles(await collectLocalFiles(localDir, opts.ignore), targetDir);
  }

  /**
   * 递归下载沙箱内一个目录到本地磁盘,与 uploadDirectory 对称:两阶段模板(与 e2b provider
   * 共用)——find 列路径 + 逐文件 readFileToBuffer(独立 HTTP GET)读取,写回本地磁盘。
   */
  async downloadDirectory(localDir: string, targetDir?: string, opts: { ignore?: string[] } = {}): Promise<void> {
    const remoteDir = resolveSandboxPath(this.workdir, targetDir);
    await downloadDirectoryByList({
      localDir,
      ignore: opts.ignore ?? [],
      runShell: (script) => this.runShell(script, { cwd: remoteDir }),
      readOne: (relPath) => this.downloadFile(`${remoteDir}/${relPath}`),
    });
  }

  async stop(): Promise<void> {
    await this.vsb.stop();
  }

  /**
   * 留存休眠(suspend):vercel `stop`——sandbox 默认持久,stop 保存文件系统,之后经
   * `Sandbox.get` 恢复(SDK 原生能力);内存态不保留,唤醒后进程要重新启动。
   */
  async suspend(): Promise<void> {
    await this.vsb.stop();
  }

  async downloadFile(path: string): Promise<Buffer> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const buf = await this.vsb.readFileToBuffer({ path: absPath });
    if (!buf) throw new Error(t("vercel.fileNotFound", { path: absPath }));
    return buf;
  }

  async uploadFile(path: string, content: Buffer): Promise<void> {
    const absPath = resolveSandboxPath(this.workdir, path);
    await this.vsb.writeFiles([{ path: absPath, content }]);
  }
}
