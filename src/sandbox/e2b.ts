// E2B 沙箱 provider:用 e2b SDK 把 E2B microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox / VercelSandbox 可互换。
//
// 鉴权:E2B_API_KEY(team 级,e2b CLI `e2b auth login` 后也写在 ~/.e2b)。
// 模板:opts.template 选 e2b 模板名/ID;省略用 e2b 默认 "base"。预制模板(烘焙好
//       codex/claude-code/bub 的 "niceeval-agents")见 sandbox/e2b/。

import { Sandbox as E2BSdkSandbox, CommandExitError, NotFoundError, RateLimitError } from "e2b";
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

// 沙箱存活上限(到点 e2b 自动回收)。给足空间跑完 setup + agent + 测试脚本。
const SESSION_TIMEOUT_MS = 1_800_000;

/** e2b 的限流错误是 SDK 原生的 RateLimitError(HTTP 429 映射而来);见 resolve.ts 的 withProvisionRetry。 */
// 对账本身只有一次机会:retry.ts 的 withProvisionRetry 对账失败就直接放弃重试、抛回原始
// create() 错误(见那边的注释)。对账走的这次 list 请求跟刚失败的 create() 往往挨得很近,
// 大概率处在同一段网络抖动里——不给它自己的重试,一次瞬时失败就会把本可能自愈的 attempt
// 判死。这里给 nextItems() 单独包一层短重试,只吃与 create() 侧同一套分类下的瞬时错误。
const RECONCILE_LIST_MAX_ATTEMPTS = 3;
const RECONCILE_LIST_RETRY_DELAY_MS = 500;

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
  /** 作者声明的实例寿命;复用下续期一律续到这个值(滑动窗口)。省略 = 没声明,不支持复用。 */
  private lifetimeMs?: number;
  readonly sandboxId: string;

  private deadlineAt?: number;
  readonly capabilities = {
    appendLog: unsupportedBackendCapability,
    suspend: supportedBackendCapability(() => this.suspend()),
    ensureLifetime: supportedBackendCapability((minRemainingMs: number) => this.ensureLifetime(minRemainingMs)),
    setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => this.setCommandDeadline(deadlineAt)),
  };

  private constructor(sbx: E2BSdkSandbox, id: string, commandTimeoutMs?: number, lifetimeMs?: number, deadlineAt?: number) {
    this.sbx = sbx;
    this.sandboxId = id;
    this.commandTimeoutMs = commandTimeoutMs;
    this.lifetimeMs = lifetimeMs;
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
    if (this.lifetimeMs === undefined) {
      return { ready: false, reason: "the e2b sandbox needs lifetimeMs when sandboxReuse is enabled" };
    }
    try {
      const remainingMs = async () => (await this.sbx.getInfo()).endAt.getTime() - Date.now();
      const before = await remainingMs();
      if (before >= minRemainingMs) return { ready: true, expiresAt: new Date(Date.now() + before).toISOString() };
      // setTimeout 是「从此刻起再活这么久」,不是增量;续到作者声明的完整寿命。
      await this.sbx.setTimeout(this.lifetimeMs);
      const after = await remainingMs();
      return after >= minRemainingMs
        ? { ready: true, expiresAt: new Date(Date.now() + after).toISOString() }
        : {
            ready: false,
            reason:
              `e2b capped this sandbox's lifetime at ${Math.round(after / 1000)}s after renewing to the declared ` +
              `lifetimeMs=${this.lifetimeMs}ms; the next attempt needs ${Math.round(minRemainingMs / 1000)}s`,
          };
    } catch (e) {
      return { ready: false, reason: `e2b could not confirm this sandbox's lifetime: ${String(e)}` };
    }
  }

  static async create(
    opts: {
      timeout?: number;
      /** attempt deadline 的截止时刻(epoch ms);单条命令按剩余量取上限。 */
      deadlineAt?: number;
      runtime?: "node20" | "node24";
      template?: string;
      provisionToken?: string;
      /** 实例寿命(复用必需)。省略时退回 SESSION_TIMEOUT_MS,只够单条 attempt 用完即弃。 */
      lifetimeMs?: number;
      /** 创建期写入的运行标识(host/pid/startedAt),供强杀之后的孤儿核对按 metadata 事后收回
       *  (见 docs/feature/sandbox/architecture.md「孤儿核对」)。 */
      runIdentity?: RunIdentity;
    } = {},
  ): Promise<E2BSandbox> {
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
    // 作者声明了 lifetimeMs 就按它建实例;没声明才退回 SESSION_TIMEOUT_MS 这个单 attempt 的兜底。
    // 之前这里恒用 SESSION_TIMEOUT_MS,是「静默压短」的源头:复用池按声明的寿命记账,实例却按
    // 30 分钟被回收(见 docs/feature/sandbox/reuse.md「两种时间不能混用」)。
    const sdkOpts = {
      apiKey,
      timeoutMs: opts.lifetimeMs ?? SESSION_TIMEOUT_MS,
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
        if (opts.lifetimeMs !== undefined && /timeout cannot be greater than/i.test(e instanceof Error ? e.message : String(e))) {
          throw new Error(
            `e2b rejected the declared lifetimeMs=${opts.lifetimeMs}ms for this account: ` +
              `${e instanceof Error ? e.message : String(e)}. Lower lifetimeMs to fit the plan's maximum sandbox ` +
              "lifetime, or raise that maximum on the e2b side; niceeval will not silently shorten it.",
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
      return new E2BSandbox(sbx, sbx.sandboxId, commandTimeoutMs, opts.lifetimeMs, opts.deadlineAt);
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
    try {
      const commandOptions = {
        cwd: resolveSandboxPath(this.workdir, opts.cwd),
        envs: opts.env,
        user: opts.root ? "root" : undefined,
        ...(limit.timeoutMs !== undefined ? { timeoutMs: limit.timeoutMs } : {}),
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
      };
      const signal = opts.signal;
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("sandbox command aborted", "AbortError");
      }
      const res = signal === undefined
        ? await this.sbx.commands.run(script, commandOptions)
        : await (async () => {
            // E2B 的 CommandHandle.kill() 只承诺 SIGKILL 入口进程，无法证明孙进程也已终止。
            // 因此取消时退休整台 Sandbox；kill() settle 后才让本次命令 Promise settle。
            const handle = await this.sbx.commands.run(script, { ...commandOptions, background: true });
            const abort = async (): Promise<never> => {
              await this.sbx.kill();
              throw signal.reason ?? new DOMException("sandbox command aborted", "AbortError");
            };
            if (signal.aborted) return await abort();
            let onAbort: (() => void) | undefined;
            const aborted = new Promise<never>((_resolve, reject) => {
              onAbort = () => void abort().catch(reject);
              signal.addEventListener("abort", onAbort, { once: true });
            });
            try {
              return await Promise.race([handle.wait(), aborted]);
            } finally {
              if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
            }
          })();
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    } catch (e) {
      // e2b 在退出码非 0 时【抛】CommandExitError;但 Sandbox 契约要求【返回】带 exitCode 的结果
      // (与 docker / vercel 一致)——否则 agent 命令 / build / 测试一旦非 0 退出就会炸,而不是被判分。
      if (e instanceof CommandExitError) {
        return { stdout: e.stdout, stderr: e.stderr, exitCode: e.exitCode };
      }
      // 撞的是我们给的那条线时,把归属一起抛出去(runner 据此落 error.timeout)。
      if (limit.timeoutMs !== undefined && isTimeoutError(e)) {
        // SDK timeout 只保证终止入口进程，不能证明命令树已经消失；按公共契约退休整台 VM。
        await this.sbx.kill();
        throw new SandboxCommandTimeoutError(
          `e2b command timed out after ${limit.timeoutMs}ms`,
          limit.timeoutMs,
          limit.explicit,
        );
      }
      throw e;
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
    await this.sbx.kill();
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
