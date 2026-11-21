import { cloudLifetimeMs } from "./cloud-lifetime.ts";
// Vercel Sandbox provider:用 @vercel/sandbox SDK 把 Vercel microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox 可互换。

import { Sandbox as VSandbox, APIError } from "@vercel/sandbox";
import { Effect } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CommandResult, CommandOptions, SandboxReuseCapability, SuccessfulCommandResult } from "../types.ts";
import { downloadDirectoryByList } from "./download-directory.ts";
import { collectLocalFiles, type CollectedLocalFile } from "./local-files.ts";
import { resolveLocalPath, resolveSandboxPath } from "./paths.ts";
import { shellQuote } from "./shell.ts";
import { commandLimit, SandboxCommandTimeoutError, type CommandLimit } from "./deadline.ts";
import { retireCommandInstance, waitForCommand } from "./background-command.ts";
import { reportActivity, reportDiagnostic } from "../runner/feedback/sink.ts";
import { classifyProvisionErrorFallback, type SandboxProvisionErrorKind } from "./errors.ts";
import { successfulCommandResult } from "./operations.ts";
import {
  supportedBackendCapability,
  unsupportedBackendCapability,
  unsupportedBackendCapabilityBecause,
  type SandboxProviderBackend,
} from "./backend.ts";

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

class VercelSessionLifetimeError extends Error {
  override readonly name = "VercelSessionLifetimeError";

  constructor(requiredMs: number, remainingMs: number) {
    super(
      `Vercel command needs ${requiredMs}ms but the current session has ${Math.max(0, remainingMs)}ms left and still has commands in flight.`,
    );
  }
}

/** 给 promise 套超时;到点 fail。计时用 Effect Clock/Sleep,超时分支中断等待 fiber,不再手工管 timer。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () => promise,
      catch: (cause) => cause,
    }).pipe(
      Effect.timeoutOrElse({
        duration: ms,
        orElse: () => Effect.fail(new Error(`timed out after ${ms}ms`)),
      }),
    ),
  );
}

export class VercelSandbox implements SandboxProviderBackend, SandboxReuseCapability {
  readonly workdir = VERCEL_WORKDIR;
  readonly otlpHost = null;
  private vsb: InstanceType<typeof VSandbox>;
  private commandTimeoutMs: number | undefined;
  private deadlineAt: number | undefined;
  private lifetimeMs: number | undefined;
  private sessionCreatedAt: number;
  private inFlightCommands = 0;
  private sessionRotation: Promise<void> | undefined;
  private readonly retirement = new AbortController();
  private stopping: Promise<void> | undefined;
  /** factory `pathPrepend`;按声明顺序前置到受管 PATH,省略 = 空数组。 */
  private readonly pathPrepend: readonly string[];
  get nativeInstanceId(): string {
    return this.sandboxId;
  }
  readonly sandboxId: string;
  readonly capabilities = {
    rootCommands: supportedBackendCapability(true as const),
    appendLog: unsupportedBackendCapability,
    suspend: supportedBackendCapability(() => this.suspend()),
    ensureLifetime: supportedBackendCapability((minRemainingMs: number) => this.ensureLifetime(minRemainingMs)),
    setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => this.setCommandDeadline(deadlineAt)),
    managedProcess: unsupportedBackendCapabilityBecause(
      "@vercel/sandbox 2.2.1 does not expose bidirectional stdin or raw output chunks",
    ),
  };

  private constructor(
    vsb: InstanceType<typeof VSandbox>,
    id: string,
    commandTimeoutMs: number | undefined,
    _runtime: string,
    pathPrepend: readonly string[] = [],
    lifetimeMs?: number,
    deadlineAt?: number,
  ) {
    this.vsb = vsb;
    this.sandboxId = id;
    this.commandTimeoutMs = commandTimeoutMs;
    this.deadlineAt = deadlineAt;
    this.sessionCreatedAt = Date.now();
    this.pathPrepend = pathPrepend;
    this.lifetimeMs = lifetimeMs;
  }

  /** 复用下由池在每次借出时换成承接者自己的 deadline(见 sandbox/deadline.ts)。 */
  setCommandDeadline(deadlineAt?: number): void {
    this.deadlineAt = deadlineAt;
  }

  static async create(opts: {
    timeout: number | undefined;
    /** attempt deadline 的截止时刻(epoch ms);单条命令按剩余量取上限。 */
    deadlineAt: number | undefined;
    runtime: "node20" | "node24";
    snapshotId: string;
    /** 实例 session 寿命；由当前 Vercel project plan 在 create 时真实校验。 */
    lifetimeMs: number | undefined;
    feedback: import("../types.ts").ScopedFeedback;
    /**
     * 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library/README.md
     * 「PATH:受管变量与 pathPrepend」)。
     */
    pathPrepend: readonly string[];
  }): Promise<VercelSandbox> {
    // Vercel 支持 node22/node24/node26/python3.13;node20 回退到 node22。
    const runtime = opts.runtime === "node20" ? "node22" : opts.runtime;
    // 单条命令没有 provider 级默认:上限恒从 attempt deadline 派生(见 deadline.ts)。
    const commandTimeoutMs = opts.timeout;

    // 凭据:优先从 env 显式传入(绕过 OIDC flow,非 TTY 环境也能用)。
    // 需要同时设 VERCEL_API_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID 三个。
    const token = process.env.VERCEL_API_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    const projectId = process.env.VERCEL_PROJECT_ID ?? "vercel-sandbox-default-project";
    const credParams = token && teamId ? { token, teamId, projectId } : {};

    // 给了 snapshotId 就从快照起 microVM(预制模板:烘焙好 agent CLI 的快照)。
    const sourceParams = opts.snapshotId
      ? { source: { type: "snapshot" as const, snapshotId: opts.snapshotId } }
      : { runtime };

    // Always send the server-side lifetime; explicit values remain provider-validated.
    const lifetimeMs = cloudLifetimeMs(opts.lifetimeMs, opts.timeout);
    const vsb = await VSandbox.create({
      timeout: lifetimeMs,
      ...sourceParams,
      ...credParams,
    });
    // sandboxId = 沙箱的持久 name(留存唤醒的查找键),不是当前 session 的 sessionId——
    // session 在 rotate / stop-resume 之间会变,name 才是 `Sandbox.get({ name })` 能找回的
    // 稳定身份(SDK 与官方文档都按 name 索引,见 vercel.com/docs/sandbox/cli-reference)。
    const id = vsb.name;
    return new VercelSandbox(vsb, id, commandTimeoutMs, runtime, opts.pathPrepend ?? [], lifetimeMs, opts.deadlineAt);
  }

  // 当前 session 的真实剩余寿命不足以覆盖即将执行的命令时，拍快照并请求一条新 session。
  // 是否允许该请求由当前 project plan 裁决，不维护一张会漂移的本地上限表。
  private async rotateSession(
    currentSession: ReturnType<InstanceType<typeof VSandbox>["currentSession"]>,
    minRemainingMs: number,
  ): Promise<void> {
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
        timeout: requestedLifetimeMs,
        source: { type: "snapshot", snapshotId },
        ...credParams,
      });
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

          code: undefined,
          identity: undefined,
        });
      });
      reportActivity(
        `[VercelSandbox] session rotated after ${Math.round(elapsed / 1000)}s -> ${newVsb.currentSession().sessionId}`.trimEnd(),
      );
    } catch (err) {
      reportDiagnostic({
        key: "vercel-rotate-failed",
        severity: "warning",
        message: `[VercelSandbox] session rotate failed (${Math.round(elapsed / 1000)}s): ${String(err)}`.trimEnd(),
        data: { sandboxId: this.sandboxId, error: String(err) },

        code: undefined,
        identity: undefined,
      });
    }
  }

  /**
   * 寿命确认:两次都读**当前 session 的远端元数据**(`createdAt + timeout`),不拿本地时钟记账,
   * 也不复读我们请求的续期值——vercel 的 plan 上限决定实际给多少,`extendTimeout` 在超出计划
   * 上限时直接抛 HTTP 400(本仓库真实跑分里恒抛,rotateIfNeeded 那条快照轮换路径就是为它写的)。
   * 请求值当答案会把「平台不给续」伪装成「续上了」,而症状要到实例中途消失才出现。
   */
  async ensureLifetime(
    minRemainingMs: number,
  ): Promise<{ ready: true; expiresAt?: string } | { ready: false; reason: string }> {
    const remainingMs = (): number => {
      const session = this.vsb.currentSession();
      return session.createdAt.getTime() + session.timeout - Date.now();
    };
    try {
      this.retirement.signal.throwIfAborted();
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
    // (见 docs/feature/sandbox/library/README.md「PATH:受管变量与 pathPrepend」)。
    const scriptWithPath =
      this.pathPrepend.length > 0 ? `PATH=${shellQuote(this.pathPrepend.join(":"))}:"$PATH"\n${script}` : script;
    return this.execDirect("bash", ["-c", scriptWithPath], opts);
  }

  /** 实际发起 Vercel `runCommand` 调用的唯一出口;`runCommand`/`runShell` 都收敛到这里。 */
  private async execDirect(cmd: string, args: readonly string[], opts: CommandOptions): Promise<CommandResult> {
    // Vercel 命令级只认 `user: "root"`(映射 `sudo: true`);其它显式值报错,省略 = `sudo: false`
    // (见 docs/feature/sandbox/library/README.md「执行身份」)。
    if (opts.user !== undefined && opts.user !== "root") {
      throw new Error(
        `the Vercel Sandbox provider only supports { user: "root" } (mapped to sudo: true) at the command level, got { user: "${opts.user}" }. Use a container provider (docker / e2b) for other identities.`,
      );
    }
    const limit = commandLimit(opts, {
      commandTimeoutMs: this.commandTimeoutMs,
      deadlineAt: this.deadlineAt,
    });
    // 只有 runner 交付的 attempt deadline 才是「当前物理实例必须承接多久」的请求。
    // 普通 provider 调用或显式的单命令 timeout 只是这条命令的执行上限，不能为此读取
    // currentSession()/轮换实例；前者在留存、文件传输等常规操作中甚至未必可用。
    while (this.sessionRotation !== undefined) await waitForCommand(this.sessionRotation, opts.signal);
    opts.signal?.throwIfAborted();
    this.retirement.signal.throwIfAborted();
    const requiredMs = this.deadlineAt === undefined && this.inFlightCommands === 0 ? undefined : limit.timeoutMs;
    const session = requiredMs === undefined ? undefined : this.vsb.currentSession();
    this.inFlightCommands++;
    try {
      if (session !== undefined && requiredMs !== undefined) {
        const remainingMs = session.createdAt.getTime() + session.timeout - Date.now();
        if (remainingMs < requiredMs) {
          if (this.inFlightCommands > 1) throw new VercelSessionLifetimeError(requiredMs, remainingMs);
          this.sessionRotation = this.rotateSession(session, requiredMs);
          try {
            await this.sessionRotation;
          } finally {
            this.sessionRotation = undefined;
          }
        }
      }
      opts.signal?.throwIfAborted();
      this.retirement.signal.throwIfAborted();
      return await this.runInSession(cmd, args, opts, limit);
    } finally {
      this.inFlightCommands--;
    }
  }

  private async runInSession(
    cmd: string,
    args: readonly string[],
    opts: CommandOptions,
    limit: CommandLimit,
  ): Promise<CommandResult> {
    const timeout = new AbortController();
    const timeoutMs = limit.timeoutMs;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timeout.abort(
              new SandboxCommandTimeoutError(
                `Vercel command timed out after ${timeoutMs}ms`,
                timeoutMs,
                limit.explicit,
              ),
            );
          }, timeoutMs);
    const signal = AbortSignal.any([
      timeout.signal,
      this.retirement.signal,
      ...(opts.signal === undefined ? [] : [opts.signal]),
    ]);
    const execute = async (): Promise<CommandResult> => {
      const finished = await this.vsb.runCommand({
        cmd,
        args: [...args],
        cwd: resolveSandboxPath(this.workdir, opts.cwd),
        ...(opts.env === undefined ? {} : { env: opts.env }),
        sudo: opts.user === "root",
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        signal,
      });
      const stdout = await finished.stdout();
      const stderr = await finished.stderr();
      if (!signal.aborted && stdout) await opts.onStdout?.(stdout);
      if (!signal.aborted && stderr) await opts.onStderr?.(stderr);
      return { stdout, stderr, exitCode: finished.exitCode };
    };
    try {
      return await waitForCommand(execute(), signal);
    } catch (cause) {
      // Cancelling the SDK stream does not acknowledge termination of the process tree.
      const reason = signal.aborted ? signal.reason : cause;
      await retireCommandInstance(opts.signal, () => this.stop());
      throw reason;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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

  private liveSandbox(): InstanceType<typeof VSandbox> {
    this.retirement.signal.throwIfAborted();
    return this.vsb;
  }

  async readText(path: string): Promise<string> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const buf = await this.liveSandbox().readFileToBuffer({ path: absPath });
    if (!buf) throw new Error(`File not found: ${absPath}`);
    return buf.toString("utf8");
  }

  async pathExists(path: string): Promise<boolean> {
    const absPath = resolveSandboxPath(this.workdir, path);
    return this.liveSandbox().fs.exists(absPath);
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
    await this.liveSandbox().writeFiles(entries);
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.liveSandbox().writeFiles([{ path: resolveSandboxPath(this.workdir, path), content }]);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const buf = await this.liveSandbox().readFileToBuffer({ path: absPath });
    if (!buf) throw new Error(`File not found: ${absPath}`);
    return buf;
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    await this.liveSandbox().writeFiles([
      {
        path: resolveSandboxPath(this.workdir, path),
        content: Buffer.from(content),
      },
    ]);
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
    if (this.stopping !== undefined) return this.stopping;
    this.retirement.abort(new Error("Vercel Sandbox is stopped"));
    const stopping = (async () => {
      await this.sessionRotation;
      await this.vsb.stop();
    })();
    this.stopping = stopping;
    try {
      await stopping;
    } catch (error) {
      this.stopping = undefined;
      throw error;
    }
  }

  /**
   * 留存休眠(suspend):vercel `stop`——sandbox 默认持久,stop 保存文件系统,之后经
   * `Sandbox.get` 恢复(SDK 原生能力);内存态不保留,唤醒后进程要重新启动。
   */
  async suspend(): Promise<void> {
    await this.vsb.stop();
  }
}
