// E2B 沙箱 provider:用 e2b SDK 把 E2B microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox / VercelSandbox 可互换。
//
// 鉴权:E2B_API_KEY(team 级,e2b CLI `e2b auth login` 后也写在 ~/.e2b)。
// 模板:opts.template 选 e2b 模板名/ID;省略用 e2b 默认 "base"。预制模板(烘焙好
//       codex/claude-code/bub 的 "niceeval-agents")见 sandbox/e2b/。

import { Sandbox as E2BSdkSandbox, CommandExitError, NotFoundError, RateLimitError } from "e2b";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CommandResult,
  CommandOptions,
  SandboxReuseCapability,
  SuccessfulCommandResult,
} from "../types.ts";
import {
  classifyProvisionErrorFallback,
  isRetryableProvisionError,
  type SandboxProvisionErrorKind,
} from "./errors.ts";
import { classifySandboxIoError } from "./errors.ts";
import { downloadDirectoryByList } from "./download-directory.ts";
import { collectLocalFiles, type CollectedLocalFile } from "./local-files.ts";
import { shellQuote } from "./shell.ts";
import { resolveLocalPath, resolveSandboxPath } from "./paths.ts";
import { e2bRunIdentityMetadata, type RunIdentity } from "./run-identity.ts";
import { commandLimit, SandboxCommandTimeoutError } from "./deadline.ts";
import { successfulCommandResult } from "./operations.ts";
import { supportedBackendCapability, unsupportedBackendCapability, type SandboxProviderBackend } from "./backend.ts";

// e2b 默认用户 "user",home 在 /home/user;工作区放其下。
const E2B_WORKDIR = "/home/user/workspace";

type E2BCommandOutputChannel = "stdout" | "stderr";

interface E2BCommandOutputState {
  pending: string;
  output: string;
  markerStarted: boolean;
  complete: boolean;
  exitCode?: number;
}

/**
 * E2B 的 command RPC 把进程终局与 stdout/stderr event stream 绑在一起。shell 已退出、但它
 * 有意留下的后台服务仍继承管道时，SDK `wait()` 会继续等 event stream EOF。这里给直接 shell
 * 加一个不改写输出目的地的 supervisor：两路 marker 都由直接 shell 结束后写出；收到后只
 * disconnect transport，不 kill 后台服务。timeout / cancellation 仍由调用方退休整台 VM。
 */
class E2BCommandCompletion {
  readonly script: string;
  readonly completion: Promise<number>;

  private readonly prefix: string;
  private readonly suffix: string;
  private readonly states: globalThis.Record<E2BCommandOutputChannel, E2BCommandOutputState> = {
    stdout: { pending: "", output: "", markerStarted: false, complete: false },
    stderr: { pending: "", output: "", markerStarted: false, complete: false },
  };
  private readonly callbacks: Partial<globalThis.Record<E2BCommandOutputChannel, (chunk: string) => void | Promise<void>>>;
  private readonly resolveCompletion: (exitCode: number) => void;
  private readonly rejectCompletion: (error: Error) => void;

  constructor(script: string, opts: Pick<CommandOptions, "onStdout" | "onStderr">) {
    const id = randomUUID().replaceAll("-", "");
    this.prefix = `__niceeval_e2b_command_${id}_exit_`;
    this.suffix = `__niceeval_e2b_command_${id}_end__`;
    this.callbacks = {
      ...(opts.onStdout ? { stdout: opts.onStdout } : {}),
      ...(opts.onStderr ? { stderr: opts.onStderr } : {}),
    };
    let resolveCompletion!: (exitCode: number) => void;
    let rejectCompletion!: (error: Error) => void;
    this.completion = new Promise<number>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    this.resolveCompletion = resolveCompletion;
    this.rejectCompletion = rejectCompletion;

    // 原脚本住在异步 subshell：它继续继承 E2B login shell 的变量、函数、cwd 与 shell option，
    // `exit` / `exec` / EXIT trap 只结束自己的 shell。外层只 wait 这个直接 shell，不会等它
    // 有意留下的孙进程；因此能在 `nohup ... &` 之后可靠写出两路终局 marker。
    this.script = [
      "(",
      script,
      ") &",
      "__niceeval_e2b_command_pid=$!",
      "if wait \"$__niceeval_e2b_command_pid\"; then",
      "  __niceeval_e2b_command_exit=0",
      "else",
      "  __niceeval_e2b_command_exit=$?",
      "fi",
      `printf '%s%s%s' ${shellQuote(this.prefix)} \"$__niceeval_e2b_command_exit\" ${shellQuote(this.suffix)}`,
      `printf '%s%s%s' ${shellQuote(this.prefix)} \"$__niceeval_e2b_command_exit\" ${shellQuote(this.suffix)} >&2`,
      "exit \"$__niceeval_e2b_command_exit\"",
    ].join("\n");
  }

  readonly onStdout = async (chunk: string): Promise<void> => this.consume("stdout", chunk);
  readonly onStderr = async (chunk: string): Promise<void> => this.consume("stderr", chunk);

  result(exitCode: number): CommandResult {
    return {
      stdout: this.states.stdout.output,
      stderr: this.states.stderr.output,
      exitCode,
    };
  }

  /** SDK 在 marker 前先结束时，把为跨 chunk 匹配暂存的普通输出交还调用方。 */
  async finish(): Promise<void> {
    for (const channel of ["stdout", "stderr"] as const) {
      const state = this.states[channel];
      if (!state.complete && !state.markerStarted && state.pending.length > 0) {
        const pending = state.pending;
        state.pending = "";
        await this.emit(channel, pending);
      }
    }

    const partial = (["stdout", "stderr"] as const).filter((channel) => {
      const state = this.states[channel];
      return state.markerStarted && !state.complete;
    });
    if (partial.length > 0) {
      throw new Error(`e2b command completion marker was truncated on ${partial.join(" and ")}`);
    }
    const completed = (["stdout", "stderr"] as const).filter((channel) => this.states[channel].complete);
    if (completed.length === 1) {
      throw new Error(`e2b command completion marker was received only on ${completed[0]}`);
    }
  }

  private async consume(channel: E2BCommandOutputChannel, chunk: string): Promise<void> {
    const state = this.states[channel];
    // 直接 shell 已结束后的输出只能来自它留下的后台服务；command transport 到这里已经封口。
    if (state.complete) return;
    state.pending += chunk;

    if (!state.markerStarted) {
      const markerAt = state.pending.indexOf(this.prefix);
      if (markerAt < 0) {
        // marker 可能跨 SDK chunk；只保留足以匹配 prefix 的尾巴，其余实时透传。
        const safeLength = Math.max(0, state.pending.length - this.prefix.length + 1);
        if (safeLength > 0) {
          const safe = state.pending.slice(0, safeLength);
          state.pending = state.pending.slice(safeLength);
          await this.emit(channel, safe);
        }
        return;
      }
      const before = state.pending.slice(0, markerAt);
      state.pending = state.pending.slice(markerAt + this.prefix.length);
      state.markerStarted = true;
      await this.emit(channel, before);
    }

    const markerEnd = state.pending.indexOf(this.suffix);
    if (markerEnd < 0) return;
    const encodedExitCode = state.pending.slice(0, markerEnd);
    if (!/^\d+$/.test(encodedExitCode)) {
      throw new Error(`e2b command completion marker carried an invalid exit code: ${JSON.stringify(encodedExitCode)}`);
    }
    state.exitCode = Number(encodedExitCode);
    state.complete = true;
    // suffix 后同一个 chunk 里的字节来自后台服务；它们不属于已经 settle 的直接命令。
    state.pending = "";
    this.maybeComplete();
  }

  private async emit(channel: E2BCommandOutputChannel, chunk: string): Promise<void> {
    if (chunk.length === 0) return;
    this.states[channel].output += chunk;
    await this.callbacks[channel]?.(chunk);
  }

  private maybeComplete(): void {
    const stdoutExit = this.states.stdout.exitCode;
    const stderrExit = this.states.stderr.exitCode;
    if (stdoutExit === undefined || stderrExit === undefined) return;
    if (stdoutExit !== stderrExit) {
      this.rejectCompletion(
        new Error(`e2b command completion markers disagreed on exit code: stdout=${stdoutExit}, stderr=${stderrExit}`),
      );
      return;
    }
    this.resolveCompletion(stdoutExit);
  }
}

/** e2b 的限流错误是 SDK 原生的 RateLimitError(HTTP 429 映射而来);见 retry.ts 的 withProvisionRetry。 */
// 对账本身只有一次机会:retry.ts 的 withProvisionRetry 对账失败就直接放弃重试、抛回原始
// create() 错误(见那边的注释)。对账走的这次 list 请求跟刚失败的 create() 往往挨得很近,
// 大概率处在同一段网络抖动里——不给它自己的重试,一次瞬时失败就会把本可能自愈的 attempt
// 判死。这里给 nextItems() 单独包一层短重试,只吃与 create() 侧同一套分类下的瞬时错误。
const RECONCILE_LIST_MAX_ATTEMPTS = 3;
const RECONCILE_LIST_RETRY_DELAY_MS = 500;

/**
 * E2B 创建请求必须明确说明寿命是作者声明、attempt deadline 派生，还是没有 deadline 可派生。
 * 把这个区分留在类型里，运行时就不会再把「没有显式 lifetimeMs」误传成 SDK 的短默认值。
 */
export type E2BSandboxLifetime =
  | { readonly _tag: "ProviderDefault" }
  | {
      readonly _tag: "Requested";
      readonly milliseconds: number;
      readonly source: "explicit" | "attempt-deadline";
    };

interface E2BSandboxCreateOptions {
  readonly timeout?: number;
  /** attempt deadline 的截止时刻(epoch ms);单条命令按剩余量取上限。 */
  readonly deadlineAt?: number;
  readonly runtime?: "node20" | "node24";
  readonly template?: string;
  readonly provisionToken?: string;
  /** 运行时已解析的实例寿命；bounded attempt 不能退回 E2B 的 SDK 默认值。 */
  readonly lifetime: E2BSandboxLifetime;
  /** 创建期写入的运行标识(host/pid/startedAt),供强杀之后的孤儿核对按 metadata 事后收回
   *  (见 docs/feature/sandbox/architecture.md「孤儿核对」)。 */
  readonly runIdentity?: RunIdentity;
}

/**
 * Provisioning 重试前的对账:按 metadata 里的 provision token 检索远端实例,查到即 kill。
 * 检索或销毁失败必须抛出——对账是重试的硬前置,静默放行等于盲重试,会复制计费实例
 * (见 docs/feature/sandbox/architecture.md「Provisioning 失败与重试」)。
 * 唯一的例外:实例已不存在(NotFound),视作对账完成。
 */
export async function reconcileProvision(token: string): Promise<void> {
  const apiKey = process.env.E2B_API_KEY;
  // Sandbox.list() 是同步方法,返回分页器(SandboxPaginator),不是 Promise<数组>——用
  // hasNext/nextItems() 翻页,不能直接 for...of。metadata 过滤走服务端 query,一次 token
  // 命中的实例数极少,通常一页打完。
  const paginator = E2BSdkSandbox.list({ apiKey, query: { metadata: { "niceeval-provision-token": token } } });
  while (paginator.hasNext) {
    const sandboxes = await fetchNextItemsWithRetry(paginator);
    for (const info of sandboxes) {
      try {
        await E2BSdkSandbox.kill(info.sandboxId, { apiKey });
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e;
      }
    }
  }
}

/**
 * `nextItems()` 按类型契约总是 resolve 成数组(SDK 内部对空响应也兜了 `?? []`),但对账这条
 * 路径线上真实撞见过它 resolve 成非数组的一次——没能复现出确切成因,不排它,原样让下面的
 * `for...of` 抛出,但换一句能定位的诊断,而不是留一条裸的 "X is not iterable"。
 */
async function fetchNextItemsWithRetry(
  paginator: ReturnType<typeof E2BSdkSandbox.list>,
): Promise<Awaited<ReturnType<typeof paginator.nextItems>>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const items = await paginator.nextItems();
      if (!Array.isArray(items)) {
        throw new Error(
          `e2b Sandbox.list() 分页器 nextItems() 返回了非数组(${typeof items}),不是 SDK 类型契约里的 SandboxInfo[]`,
        );
      }
      return items;
    } catch (e) {
      const kind = classifyProvisionErrorFallback(e);
      if (attempt >= RECONCILE_LIST_MAX_ATTEMPTS - 1 || !isRetryableProvisionError(kind)) throw e;
      await new Promise((resolve) => setTimeout(resolve, RECONCILE_LIST_RETRY_DELAY_MS * 2 ** attempt));
    }
  }
}

export function classifyProvisionError(e: unknown): SandboxProvisionErrorKind {
  // SDK 原生限流先归拒绝类;没认出的过与文件 IO 共用的保守瞬时兜底分类器
  // (真实跑分里出现过 create 阶段 `fetch failed · other side closed`,属歧义类)。
  if (e instanceof RateLimitError) return "rate_limit";
  return classifyProvisionErrorFallback(e);
}

export class E2BSandbox implements SandboxProviderBackend, SandboxReuseCapability {
  readonly workdir = E2B_WORKDIR;
  readonly otlpHost = null;
  private sbx: E2BSdkSandbox;
  private commandTimeoutMs?: number;
  /** A VM retirement is idempotent across abort, transport failure, and the scope finalizer. */
  private retirement?: Promise<void>;
  private retired = false;
  /** 已实际请求的实例寿命;复用下续期一律续到这个值(滑动窗口)。 */
  private lifetime: E2BSandboxLifetime;
  readonly sandboxId: string;

  private deadlineAt?: number;
  readonly capabilities = {
    rootCommands: supportedBackendCapability(true as const),
    appendLog: unsupportedBackendCapability,
    suspend: supportedBackendCapability(() => this.suspend()),
    ensureLifetime: supportedBackendCapability((minRemainingMs: number) => this.ensureLifetime(minRemainingMs)),
    setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => this.setCommandDeadline(deadlineAt)),
  };

  private constructor(
    sbx: E2BSdkSandbox,
    id: string,
    commandTimeoutMs: number | undefined,
    lifetime: E2BSandboxLifetime,
    deadlineAt?: number,
  ) {
    this.sbx = sbx;
    this.sandboxId = id;
    this.commandTimeoutMs = commandTimeoutMs;
    this.lifetime = lifetime;
    this.deadlineAt = deadlineAt;
  }

  /** 复用下由池在每次借出时换成承接者自己的 deadline(见 sandbox/deadline.ts)。 */
  setCommandDeadline(deadlineAt?: number): void {
    this.deadlineAt = deadlineAt;
  }

  /**
   * 寿命确认:先问远端真实到期时刻,不够再续,续完**重新问一次**。
   *
   * 两处都读 `getInfo().endAt` 而不是复读我们请求的值,是这条能力的全部要害——e2b 的账号档位
   * 会把 `setTimeout` 的请求值压到平台上限(免费档尤其明显)。拿请求值记账等于把「平台压短了」
   * 伪装成「作者声明生效了」,而症状要到 attempt 跑到一半、实例被回收时才出现,那时只剩一句
   * 无归属的 sandbox 消失。宁可在这里如实报 `ready: false` 让 runner 轮换实例。
   */
  async ensureLifetime(minRemainingMs: number): Promise<{ ready: true; expiresAt?: string } | { ready: false; reason: string }> {
    if (this.lifetime._tag === "ProviderDefault") {
      return {
        ready: false,
        reason: "the e2b sandbox has no requested lifetime; an unlimited attempt must declare lifetimeMs before sandboxReuse",
      };
    }
    try {
      const remainingMs = async () => (await this.sbx.getInfo()).endAt.getTime() - Date.now();
      const before = await remainingMs();
      if (before >= minRemainingMs) return { ready: true, expiresAt: new Date(Date.now() + before).toISOString() };
      // setTimeout 是「从此刻起再活这么久」,不是增量;续到创建期实际请求的完整寿命。
      await this.sbx.setTimeout(this.lifetime.milliseconds);
      const after = await remainingMs();
      return after >= minRemainingMs
        ? { ready: true, expiresAt: new Date(Date.now() + after).toISOString() }
        : {
            ready: false,
            reason:
              `e2b capped this sandbox's lifetime at ${Math.round(after / 1000)}s after renewing to the ${
                this.lifetime.source === "explicit" ? "declared" : "attempt-deadline-derived"
              } ` +
              `lifetimeMs=${this.lifetime.milliseconds}ms; the next attempt needs ${Math.round(minRemainingMs / 1000)}s`,
          };
    } catch (e) {
      return { ready: false, reason: `e2b could not confirm this sandbox's lifetime: ${String(e)}` };
    }
  }

  static async create(opts: E2BSandboxCreateOptions): Promise<E2BSandbox> {
    // 单条命令没有 provider 级默认:上限恒从 attempt deadline 派生(见 deadline.ts)。
    const commandTimeoutMs = opts.timeout;
    // e2b 的 node 版本由模板决定,runtime 仅作记录(不在创建时选)。
    const apiKey = process.env.E2B_API_KEY;
    // provision token 与运行标识都经 metadata 打进实例(同一通道):歧义类失败(fetch failed ·
    // other side closed)重试前按 token 检索远端、销毁可能已创建的实例(见 reconcileProvision);
    // 运行标识供 `sandbox list --orphans` 按 metadata 过滤事后核对。
    const metadata: globalThis.Record<string, string> = {
      ...(opts.provisionToken ? { "niceeval-provision-token": opts.provisionToken } : {}),
      ...(opts.runIdentity ? e2bRunIdentityMetadata(opts.runIdentity) : {}),
    };
    // bounded attempt 一定携带由 runtime 派生的 timeoutMs；只有没有 deadline 可派生的
    // unlimited attempt 才允许 ProviderDefault。NiceEval 不把某个账号档位观测到的上限硬编码
    // 成全体用户的契约。
    const sdkOpts = {
      apiKey,
      ...(opts.lifetime._tag === "Requested" ? { timeoutMs: opts.lifetime.milliseconds } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    } as const;
    // 有 template 就从模板起,否则用 e2b 默认 "base"。
    const sbx = await (async () => {
      try {
        return opts.template ? await E2BSdkSandbox.create(opts.template, sdkOpts) : await E2BSdkSandbox.create(sdkOpts);
      } catch (e) {
        // 声明的寿命超出账号档位上限时,e2b 返回 400「Timeout cannot be greater than N hours」。
        // 这是确定性配置死因(同一个值重试多少次都是同一个 400),而裸 SDK 栈既不说是哪个字段
        // 惹的祸、也不说上限是多少。把 provider 的理由原样带出来并指到 lifetimeMs 上——
        // 「不能静默压短」的另一半是「压不下就把原因说清楚」
        // (见 docs/feature/sandbox/reuse.md「派发前确认」)。
        if (opts.lifetime._tag === "Requested" && /timeout cannot be greater than/i.test(e instanceof Error ? e.message : String(e))) {
          throw new Error(
            `e2b rejected the ${opts.lifetime.source === "explicit" ? "declared" : "attempt-deadline-derived"} ` +
              `lifetimeMs=${opts.lifetime.milliseconds}ms for this account: ${e instanceof Error ? e.message : String(e)}. ` +
              "Lower the attempt timeout or lifetimeMs to fit the plan's maximum sandbox lifetime, or raise that maximum " +
              "on the e2b side; niceeval will not silently shorten it.",
            { cause: e },
          );
        }
        throw e;
      }
    })();
    // kill-on-failure:实例句柄已到手,创建之后的初始化请求(如下面的 mkdir 撞 429)一旦失败,
    // 先尽力销毁实例再抛出原始错误——否则重试层按「拒绝类=远端没有实例」盲重试,就会复制一台
    // 计费实例(见 docs/feature/sandbox/architecture.md「Provisioning 失败与重试」)。
    try {
      // 备好工作区目录(模板默认 cwd 是 home,workspace 子目录可能不存在)。
      await sbx.commands.run(`mkdir -p ${E2B_WORKDIR}`);
      return new E2BSandbox(sbx, sbx.sandboxId, commandTimeoutMs, opts.lifetime, opts.deadlineAt);
    } catch (e) {
      await sbx.kill().catch(() => {});
      throw e;
    }
  }

  async runCommand(cmd: string, args: readonly string[] = [], opts: CommandOptions = {}): Promise<CommandResult> {
    const line = [cmd, ...args.map(shellQuote)].join(" ");
    return this.runShell(line, opts);
  }

  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    // e2b commands.run 经 bash 执行 → 支持 && / 管道 / $()。root 用户映射到 { user: "root" },
    // 否则用模板默认(非 root)用户 —— 跨 provider 语义一致(见 types.ts 的 CommandOptions.root)。
    const limit = commandLimit(opts, { commandTimeoutMs: this.commandTimeoutMs, deadlineAt: this.deadlineAt });
    const completion = new E2BCommandCompletion(script, opts);
    // Attach a rejection handler before starting the SDK command. A malformed marker can reject while
    // commands.run() is still delivering its initial events; keeping this outcome fulfilled avoids an
    // unhandled rejection before the command handle is returned.
    const completionOutcome = completion.completion.then(
      (exitCode) => ({ _tag: "DirectShellExited" as const, exitCode }),
      (error: unknown) => ({ _tag: "CompletionFailed" as const, error }),
    );
    const signal = opts.signal;
    let aborted = false;
    let cancellationReason: unknown = new DOMException("sandbox command aborted", "AbortError");
    let abortRetirement: Promise<void> | undefined;
    let resolveAbort: ((outcome: { readonly _tag: "Aborted"; readonly reason: unknown }) => void) | undefined;
    const abortOutcome = signal === undefined
      ? undefined
      : new Promise<{ readonly _tag: "Aborted"; readonly reason: unknown }>((resolve) => {
          resolveAbort = resolve;
        });
    const onAbort = signal === undefined
      ? undefined
      : () => {
          if (aborted) return;
          // This flag must change synchronously. Marker delivery can finish while kill() is still in
          // flight; every success path checks it before settling and awaits the same retirement.
          aborted = true;
          cancellationReason = signal.reason ?? new DOMException("sandbox command aborted", "AbortError");
          abortRetirement ??= this.retire();
          // Cancellation waits for retirement to settle, but a kill transport failure must not
          // replace the caller's AbortSignal reason. A later stop() may retry a failed kill.
          void abortRetirement.then(
            () => resolveAbort?.({ _tag: "Aborted", reason: cancellationReason }),
            () => resolveAbort?.({ _tag: "Aborted", reason: cancellationReason }),
          );
        };
    const throwIfAborted = async (): Promise<void> => {
      if (!aborted) return;
      await abortRetirement?.catch(() => undefined);
      throw cancellationReason;
    };

    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort!, { once: true });
      // Close the check/listener race: AbortSignal does not replay an abort to a late listener.
      if (signal.aborted) onAbort!();
    }
    try {
      const commandOptions = {
        cwd: resolveSandboxPath(this.workdir, opts.cwd),
        envs: opts.env,
        user: opts.root ? "root" : undefined,
        ...(limit.timeoutMs !== undefined ? { timeoutMs: limit.timeoutMs } : {}),
        onStdout: completion.onStdout,
        onStderr: completion.onStderr,
        background: true as const,
      };
      await throwIfAborted();
      // Starting a background command is itself a remote RPC and can hang. Race handle acquisition
      // against the abort retirement, while eagerly handling a late start rejection.
      const commandStartOutcome = this.sbx.commands.run(completion.script, commandOptions).then(
        (handle) => ({ _tag: "HandleReady" as const, handle }),
        (error: unknown) => ({ _tag: "HandleFailed" as const, error }),
      );
      const startOutcome = await Promise.race([
        commandStartOutcome,
        ...(abortOutcome ? [abortOutcome] : []),
      ]);
      await throwIfAborted();
      if (startOutcome._tag === "Aborted") throw startOutcome.reason;
      if (startOutcome._tag === "HandleFailed") throw startOutcome.error;
      const handle = startOutcome.handle;
      const streamOutcome = handle.wait().then(
        (result) => ({ _tag: "SdkStreamEnded" as const, result }),
        (error: unknown) => ({ _tag: "SdkStreamFailed" as const, error }),
      );
      const outcome = await Promise.race([
        completionOutcome,
        streamOutcome,
        ...(abortOutcome ? [abortOutcome] : []),
      ]);
      await throwIfAborted();
      if (outcome._tag === "DirectShellExited") {
        // SDK 文档保证 disconnect 只断 event transport、不 kill command。直接 shell 已退出；仍持有
        // stdout/stderr 的只能是它有意留下的后台服务，正是这条路径要保留的对象。
        await handle.disconnect();
        await throwIfAborted();
        return completion.result(outcome.exitCode);
      }
      if (outcome._tag === "CompletionFailed" || outcome._tag === "SdkStreamFailed") {
        throw outcome.error;
      }
      if (outcome._tag === "Aborted") throw outcome.reason;
      await completion.finish();
      await throwIfAborted();
      return completion.result(outcome.result.exitCode);
    } catch (e) {
      if (aborted) {
        await abortRetirement?.catch(() => undefined);
        throw cancellationReason;
      }
      // e2b 在退出码非 0 时【抛】CommandExitError;但 Sandbox 契约要求【返回】带 exitCode 的结果
      // (与 docker / vercel 一致)——否则 agent 命令 / build / 测试一旦非 0 退出就会炸,而不是被判分。
      if (e instanceof CommandExitError) {
        try {
          await completion.finish();
        } catch (callbackError) {
          if (aborted) {
            await abortRetirement?.catch(() => undefined);
            throw cancellationReason;
          }
          await this.retire();
          throw callbackError;
        }
        await throwIfAborted();
        return completion.result(e.exitCode);
      }
      // 撞的是我们给的那条线时,把归属一起抛出去(runner 据此落 error.timeout)。
      if (limit.timeoutMs !== undefined && isTimeoutError(e)) {
        // SDK timeout 只保证终止入口进程，不能证明命令树已经消失；按公共契约退休整台 VM。
        await this.retire();
        throw new SandboxCommandTimeoutError(
          `e2b command timed out after ${limit.timeoutMs}ms`,
          limit.timeoutMs,
          limit.explicit,
        );
      }
      // Stream transport, output callbacks, marker integrity, and disconnect failures all leave the
      // managed command tree in an unknown state. Retire the VM before exposing the original error.
      await this.retire();
      throw e;
    } finally {
      if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
    }
  }

  private abs(path: string): string {
    return resolveSandboxPath(this.workdir, path);
  }

  async runCommandOrThrow(
    cmd: string,
    args: readonly string[] = [],
    opts: CommandOptions = {},
  ): Promise<SuccessfulCommandResult> {
    return successfulCommandResult(await this.runCommand(cmd, args, opts));
  }

  async runShellOrThrow(script: string, opts: CommandOptions = {}): Promise<SuccessfulCommandResult> {
    return successfulCommandResult(await this.runShell(script, opts));
  }

  async readText(path: string): Promise<string> {
    return this.sbx.files.read(this.abs(path), { format: "text" });
  }

  async pathExists(path: string): Promise<boolean> {
    try {
      return await this.sbx.files.exists(this.abs(path));
    } catch (error) {
      // 不把瞬时网络/服务错误伪装成“不存在”，交给统一 IO 层重试。
      if (classifySandboxIoError(error) !== "unknown") throw error;
      return false;
    }
  }

  // targetDir 已由 paths.ts 的 normalizeSandboxPaths 解析成绝对路径;这里再解析一次
  // 只是对直接使用 provider 实例(未包 normalize)的幂等防御,提到 map 外只算一次。
  private async writeCollectedFiles(files: readonly CollectedLocalFile[], targetDir?: string): Promise<void> {
    const base = resolveSandboxPath(this.workdir, targetDir);
    const entries = files.map(({ path, content }) => ({
      path: resolveSandboxPath(base, path),
      data: toArrayBuffer(content),
    }));
    if (entries.length === 0) return;
    await this.sbx.files.write(entries);
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.sbx.files.write(this.abs(path), content);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return this.sbx.files.read(this.abs(path), { format: "bytes" });
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    await this.sbx.files.write(this.abs(path), toArrayBuffer(content));
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
   * 递归下载沙箱内一个目录到本地磁盘,与 uploadDirectory 对称:两阶段模板(与 vercel provider
   * 共用)——find 列路径 + 逐文件 files.read(bytes) 独立读取,写回本地磁盘。
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
    await this.retire();
  }

  private retire(): Promise<void> {
    if (this.retired) return Promise.resolve();
    if (this.retirement !== undefined) return this.retirement;
    let attempt!: Promise<void>;
    attempt = this.sbx.kill().then(
      () => {
        this.retired = true;
        if (this.retirement === attempt) this.retirement = undefined;
      },
      (error: unknown) => {
        if (this.retirement === attempt) this.retirement = undefined;
        throw error;
      },
    );
    this.retirement = attempt;
    return attempt;
  }

  /**
   * 留存休眠(suspend):e2b `pause`——文件系统与内存整体持久化,暂停期间停止计费,
   * 现场无限期保留、可 resume 找回(没有自然过期时刻,注册表不写 expiresAt)。
   * SDK 版本差异按能力探测(betaPause 是旧名),都没有则如实抛错(现场保持 alive)。
   */
  async suspend(): Promise<void> {
    await this.sbx.pause();
  }

}

/** Uint8Array → ArrayBuffer(e2b files.write 接受 string | ArrayBuffer | Blob | ReadableStream)。 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** e2b SDK 的命令超时:SDK 不导出可 instanceof 的类型,按错误名与文案判定(只用于归属标注)。 */
function isTimeoutError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === "TimeoutError" || /timed? ?out/i.test(e.message);
}
