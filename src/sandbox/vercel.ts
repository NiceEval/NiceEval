// Vercel Sandbox provider:用 @vercel/sandbox SDK 把 Vercel microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox 可互换。

import { Sandbox as VSandbox, APIError } from "@vercel/sandbox";
import { Effect } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CommandResult,
  CommandOptions,
  SandboxReuseCapability,
  SuccessfulCommandResult,
} from "../types.ts";
import { downloadDirectoryByList } from "./download-directory.ts";
import { collectLocalFiles, type CollectedLocalFile } from "./local-files.ts";
import { resolveLocalPath, resolveSandboxPath } from "./paths.ts";
import { shellQuote } from "./shell.ts";
import { commandLimit } from "./deadline.ts";
import { t } from "../i18n/index.ts";
import { reportActivity, reportDiagnostic } from "../runner/feedback/sink.ts";
import { classifyProvisionErrorFallback, type SandboxProvisionErrorKind } from "./errors.ts";
import { successfulCommandResult } from "./operations.ts";
import { supportedBackendCapability, unsupportedBackendCapability, type SandboxProviderBackend } from "./backend.ts";

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

// rotate 时停掉旧 session 的等待上限:stop 挂起时不无限拖住当前命令。
const STOP_OLD_SESSION_TIMEOUT_MS = 15_000;

/** 给 promise 套超时;到点 fail。计时用 Effect Clock/Sleep,超时分支中断等待 fiber,不再手工管 timer。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () => promise,
      catch: (cause) => cause,
    }).pipe(
      Effect.timeoutFail({
        duration: ms,
        onTimeout: () => new Error(`timed out after ${ms}ms`),
      }),
    ),
  );
}

export class VercelSandbox implements SandboxProviderBackend, SandboxReuseCapability {
  readonly workdir = VERCEL_WORKDIR;
  readonly otlpHost = null;
  private vsb: InstanceType<typeof VSandbox>;
  private commandTimeoutMs?: number;
  private deadlineAt?: number;
  private lifetimeMs?: number;
  private sessionCreatedAt: number;
  private runtime: string;
  /** factory `pathPrepend`;按声明顺序前置到受管 PATH,省略 = 空数组。 */
  private readonly pathPrepend: readonly string[];
  readonly sandboxId: string;
  readonly capabilities = {
    rootCommands: supportedBackendCapability(true as const),
    appendLog: unsupportedBackendCapability,
    suspend: supportedBackendCapability(() => this.suspend()),
    ensureLifetime: supportedBackendCapability((minRemainingMs: number) => this.ensureLifetime(minRemainingMs)),
    setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => this.setCommandDeadline(deadlineAt)),
  };

  private constructor(
    vsb: InstanceType<typeof VSandbox>,
    id: string,
    commandTimeoutMs: number | undefined,
    runtime: string,
    pathPrepend: readonly string[] = [],
    lifetimeMs?: number,
    deadlineAt?: number,
  ) {
    this.vsb = vsb;
    this.sandboxId = id;
    this.commandTimeoutMs = commandTimeoutMs;
    this.deadlineAt = deadlineAt;
    this.sessionCreatedAt = Date.now();
    this.runtime = runtime;
    this.pathPrepend = pathPrepend;
    this.lifetimeMs = lifetimeMs;
  }

  /** 复用下由池在每次借出时换成承接者自己的 deadline(见 sandbox/deadline.ts)。 */
  setCommandDeadline(deadlineAt?: number): void {
    this.deadlineAt = deadlineAt;
  }

  static async create(
    opts: {
      timeout?: number;
      /** attempt deadline 的截止时刻(epoch ms);单条命令按剩余量取上限。 */
      deadlineAt?: number;
      runtime?: "node20" | "node24";
      snapshotId?: string;
      /** 实例 session 寿命；由当前 Vercel project plan 在 create 时真实校验。 */
      lifetimeMs?: number;
      feedback?: import("../types.ts").ScopedFeedback;
      /**
       * 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library.md
       * 「PATH:受管变量与 pathPrepend」)。
       */
      pathPrepend?: readonly string[];
    } = {},
  ): Promise<VercelSandbox> {
    // Vercel 支持 node22/node24/node26/python3.13;node20 回退到 node22。
    const runtime = opts.runtime === "node20" ? "node22" : (opts.runtime ?? "node24");
    // 单条命令没有 provider 级默认:上限恒从 attempt deadline 派生(见 deadline.ts)。
    const commandTimeoutMs = opts.timeout;

    // 凭据:优先从 env 显式传入(绕过 OIDC flow,非 TTY 环境也能用)。
    // 需要同时设 VERCEL_API_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID 三个。
    const token = process.env.VERCEL_API_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    const projectId = process.env.VERCEL_PROJECT_ID ?? "vercel-sandbox-default-project";
    const credParams = token && teamId ? { token, teamId, projectId } : {};

    // 给了 snapshotId 就从快照起 microVM(预制模板:烘焙好 agent CLI 的快照)。
    const sourceParams = opts.snapshotId ? { source: { type: "run", snapshotId: opts.snapshotId } } : {};

    // 未声明 lifetimeMs 时交给 provider 选择默认值；声明后原值交给 provider 校验，绝不按
    // 本地假定的账号上限静默压短。
    const vsb = await VSandbox.create({
      runtime,
      ...(opts.lifetimeMs !== undefined ? { timeout: opts.lifetimeMs } : {}),
      ...sourceParams,
      ...credParams,
    } as Parameters<typeof VSandbox.create>[0]);
    // sandboxId = 沙箱的持久 name(留存唤醒的查找键),不是当前 session 的 sessionId——
    // session 在 rotate / stop-resume 之间会变,name 才是 `Sandbox.get({ name })` 能找回的
    // 稳定身份(SDK 与官方文档都按 name 索引,见 vercel.com/docs/sandbox/cli-reference)。
    const id = vsb.name;
    return new VercelSandbox(vsb, id, commandTimeoutMs, runtime, opts.pathPrepend ?? [], opts.lifetimeMs, opts.deadlineAt);
  }

  // 当前 session 的真实剩余寿命不足以覆盖即将执行的命令时，拍快照并请求一条新 session。
  // 是否允许该请求由当前 project plan 裁决，不维护一张会漂移的本地上限表。
  private async rotateIfNeeded(minRemainingMs: number | undefined): Promise<void> {
    if (minRemainingMs === undefined) return;
    const currentSession = this.vsb.currentSession();
    const remainingMs = currentSession.createdAt.getTime() + currentSession.timeout - Date.now();
    if (remainingMs >= minRemainingMs) return;
    const requestedLifetimeMs = this.lifetimeMs ?? Math.max(currentSession.timeout, minRemainingMs);
    const elapsed = Date.now() - this.sessionCreatedAt;

    const token = process.env.VERCEL_API_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    const projectId = process.env.VERCEL_PROJECT_ID ?? "vercel-sandbox-default-project";
    const credParams = token && teamId ? { token, teamId, projectId } : {};

    try {
      const snap = await this.vsb.snapshot();
      const snapshotId = snap.snapshotId;
      const newVsb = await VSandbox.create({
        runtime: this.runtime,
        timeout: requestedLifetimeMs,
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

  /**
   * 寿命确认:两次都读**当前 session 的远端元数据**(`createdAt + timeout`),不拿本地时钟记账,
   * 也不复读我们请求的续期值——vercel 的 plan 上限决定实际给多少,`extendTimeout` 在超出计划
   * 上限时直接抛 HTTP 400(本仓库真实跑分里恒抛,rotateIfNeeded 那条快照轮换路径就是为它写的)。
   * 请求值当答案会把「平台不给续」伪装成「续上了」,而症状要到实例中途消失才出现。
   */
  async ensureLifetime(minRemainingMs: number): Promise<{ ready: true; expiresAt?: string } | { ready: false; reason: string }> {
    const remainingMs = (): number => {
      const session = this.vsb.currentSession();
      return session.createdAt.getTime() + session.timeout - Date.now();
    };
    try {
      const before = remainingMs();
      if (before >= minRemainingMs) return { ready: true, expiresAt: new Date(Date.now() + before).toISOString() };
      await this.vsb.extendTimeout(minRemainingMs - before);
      const after = remainingMs();
      return after >= minRemainingMs
        ? { ready: true, expiresAt: new Date(Date.now() + after).toISOString() }
        : {
            ready: false,
            reason:
              `vercel granted only ${Math.round(after / 1000)}s after extendTimeout; the next attempt needs ` +
              `${Math.round(minRemainingMs / 1000)}s (the plan's maximum execution timeout caps it)`,
          };
    } catch (e) {
      return {
        ready: false,
        reason:
          "vercel refused to extend this sandbox's session (extendTimeout is rejected above the plan's maximum " +
          `execution timeout): ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  async runCommand(cmd: string, args: readonly string[] = [], opts: CommandOptions = {}): Promise<CommandResult> {
    // pathPrepend 只能在 bash 里靠 `$PATH` 展开;直接 exec 的 cmd/args 不经 shell,
    // 因此路过 runShell 走同一条 bash -c 通道(与 docker `opts.stream` 的 tee 重路由同构)。
    if (this.pathPrepend.length > 0) {
      const joined = [cmd, ...args.map(shellQuote)].join(" ");
      return this.runShell(joined, opts);
    }
    return this.execDirect(cmd, args, opts);
  }

  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    // pathPrepend 是受管 PATH,在脚本自己的 shell 里对 `$PATH` 前置——env 走的是 SDK 的
    // env 参数(可能被 opts.env.PATH 覆盖),而这一行在它之后执行,始终生效
    // (见 docs/feature/sandbox/library.md「PATH:受管变量与 pathPrepend」)。
    const scriptWithPath = this.pathPrepend.length > 0
      ? `PATH=${shellQuote(this.pathPrepend.join(":"))}:"$PATH"\n${script}`
      : script;
    return this.execDirect("bash", ["-c", scriptWithPath], opts);
  }

  /** 实际发起 Vercel `runCommand` 调用的唯一出口;`runCommand`/`runShell` 都收敛到这里。 */
  private async execDirect(cmd: string, args: readonly string[], opts: CommandOptions): Promise<CommandResult> {
    // Vercel 命令级只认 `user: "root"`(映射 `sudo: true`);其它显式值报错,省略 = `sudo: false`
    // (见 docs/feature/sandbox/library.md「执行身份」)。
    if (opts.user !== undefined && opts.user !== "root") {
      throw new Error(t("vercel.userUnsupported", { user: opts.user }));
    }
    const limit = commandLimit(opts, { commandTimeoutMs: this.commandTimeoutMs, deadlineAt: this.deadlineAt });
    // 只有 runner 交付的 attempt deadline 才是「当前物理实例必须承接多久」的请求。
    // 普通 provider 调用或显式的单命令 timeout 只是这条命令的执行上限，不能为此读取
    // currentSession()/轮换实例；前者在留存、文件传输等常规操作中甚至未必可用。
    await this.rotateIfNeeded(this.deadlineAt === undefined ? undefined : limit.timeoutMs);
    const finished = await this.vsb.runCommand({
      cmd,
      args: [...args],
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      env: opts.env,
      sudo: opts.user === "root",
      // per-command 上限从 attempt deadline 的剩余量派生(显式传 timeout 时按显式值);
      // 没有 deadline 就不设,provider 层不发明一条自己的线。
      ...(limit.timeoutMs !== undefined ? { timeoutMs: limit.timeoutMs } : {}),
      signal: opts.signal,
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

  async runCommandOrThrow(
    cmd: string,
    args: readonly string[] = [],
    opts: CommandOptions = {},
  ): Promise<SuccessfulCommandResult> {
    return successfulCommandResult(await this.runCommand(cmd, args, opts), opts.sensitiveValues);
  }

  async runShellOrThrow(script: string, opts: CommandOptions = {}): Promise<SuccessfulCommandResult> {
    return successfulCommandResult(await this.runShell(script, opts), opts.sensitiveValues);
  }

  async readText(path: string): Promise<string> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const buf = await this.vsb.readFileToBuffer({ path: absPath });
    if (!buf) throw new Error(t("vercel.fileNotFound", { path: absPath }));
    return buf.toString("utf8");
  }

  async pathExists(path: string): Promise<boolean> {
    const absPath = resolveSandboxPath(this.workdir, path);
    return this.vsb.fs.exists(absPath);
  }

  // targetDir 已由 paths.ts 的 normalizeSandboxPaths 解析成绝对路径;这里再解析一次
  // 只是对直接使用 provider 实例(未包 normalize)的幂等防御,提到 map 外只算一次。
  private async writeCollectedFiles(files: readonly CollectedLocalFile[], targetDir?: string): Promise<void> {
    const base = resolveSandboxPath(this.workdir, targetDir);
    const entries = files.map(({ path, content }) => ({
      path: resolveSandboxPath(base, path),
      content: Buffer.from(content),
    }));
    if (entries.length === 0) return;
    await this.vsb.writeFiles(entries);
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.vsb.writeFiles([{ path: resolveSandboxPath(this.workdir, path), content }]);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const buf = await this.vsb.readFileToBuffer({ path: absPath });
    if (!buf) throw new Error(t("vercel.fileNotFound", { path: absPath }));
    return buf;
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    await this.vsb.writeFiles([{
      path: resolveSandboxPath(this.workdir, path),
      content: Buffer.from(content),
    }]);
  }

  async uploadFile(source: string | URL, targetPath: string): Promise<void> {
    await this.writeBytes(targetPath, await readFile(resolveLocalPath(undefined, source)));
  }

  async uploadDirectory(
    sourceDir: string | URL,
    targetDir?: string,
    opts: { readonly ignore?: readonly string[] } = {},
  ): Promise<void> {
    await this.writeCollectedFiles(
      await collectLocalFiles(resolveLocalPath(undefined, sourceDir), opts.ignore),
      targetDir,
    );
  }

  /**
   * 递归下载沙箱内一个目录到本地磁盘,与 uploadDirectory 对称:两阶段模板(与 e2b provider
   * 共用)——find 列路径 + 逐文件 readFileToBuffer(独立 HTTP GET)读取,写回本地磁盘。
   */
  async downloadFile(sourcePath: string, target: string | URL): Promise<void> {
    const destination = resolveLocalPath(undefined, target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await this.readBytes(sourcePath));
  }

  async downloadDirectory(
    sourceDir: string,
    targetDir: string | URL,
    opts: { readonly ignore?: readonly string[] } = {},
  ): Promise<void> {
    const remoteDir = resolveSandboxPath(this.workdir, sourceDir);
    await downloadDirectoryByList({
      localDir: resolveLocalPath(undefined, targetDir),
      ignore: opts.ignore ?? [],
      runShell: (script) => this.runShell(script, { cwd: remoteDir }),
      readOne: (relPath) => this.readBytes(`${remoteDir}/${relPath}`),
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

}
