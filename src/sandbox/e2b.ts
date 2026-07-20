// E2B 沙箱 provider:用 e2b SDK 把 E2B microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox / VercelSandbox 可互换。
//
// 鉴权:E2B_API_KEY(team 级,e2b CLI `e2b auth login` 后也写在 ~/.e2b)。
// 模板:opts.template 选 e2b 模板名/ID;省略用 e2b 默认 "base"。预制模板(烘焙好
//       codex/claude-code/bub 的 "niceeval-agents")见 sandbox/e2b/。

import { Sandbox as E2BSdkSandbox, CommandExitError, NotFoundError, RateLimitError } from "e2b";
import type {
  Sandbox,
  CommandResult,
  CommandOptions,
  SandboxFile,
  SourceFiles,
  ReadSourceFilesOptions,
} from "../types.ts";
import {
  classifyProvisionErrorFallback,
  isRetryableProvisionError,
  type SandboxProvisionErrorKind,
} from "./errors.ts";
import { classifySandboxIoError } from "./errors.ts";
import { readSourceFilesByList } from "./source-files.ts";
import { collectLocalFiles } from "./local-files.ts";
import { shellQuote } from "./shell.ts";
import { resolveSandboxPath } from "./paths.ts";

// e2b 默认用户 "user",home 在 /home/user;工作区放其下。
const E2B_WORKDIR = "/home/user/workspace";

// 单条命令默认超时(10 分钟),防止长跑的 build/install 被截断。
const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
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

export class E2BSandbox implements Sandbox {
  readonly workdir = E2B_WORKDIR;
  readonly otlpHost = null;
  private sbx: E2BSdkSandbox;
  private commandTimeoutMs: number;
  readonly sandboxId: string;

  private constructor(sbx: E2BSdkSandbox, id: string, commandTimeoutMs: number) {
    this.sbx = sbx;
    this.sandboxId = id;
    this.commandTimeoutMs = commandTimeoutMs;
  }

  static async create(
    opts: { timeout?: number; runtime?: "node20" | "node24"; template?: string; provisionToken?: string } = {},
  ): Promise<E2BSandbox> {
    const commandTimeoutMs = opts.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS;
    // e2b 的 node 版本由模板决定,runtime 仅作记录(不在创建时选)。
    const apiKey = process.env.E2B_API_KEY;
    // provision token 经 metadata 打进实例:歧义类失败(fetch failed · other side closed)
    // 重试前按它检索远端、销毁可能已创建的实例(见 reconcileProvision)。
    const sdkOpts = {
      apiKey,
      timeoutMs: SESSION_TIMEOUT_MS,
      ...(opts.provisionToken ? { metadata: { "niceeval-provision-token": opts.provisionToken } } : {}),
    } as const;
    // 有 template 就从模板起,否则用 e2b 默认 "base"。
    const sbx = opts.template
      ? await E2BSdkSandbox.create(opts.template, sdkOpts)
      : await E2BSdkSandbox.create(sdkOpts);
    // kill-on-failure:实例句柄已到手,创建之后的初始化请求(如下面的 mkdir 撞 429)一旦失败,
    // 先尽力销毁实例再抛出原始错误——否则重试层按「拒绝类=远端没有实例」盲重试,就会复制一台
    // 计费实例(见 docs/feature/sandbox/architecture.md「Provisioning 失败与重试」)。
    try {
      // 备好工作区目录(模板默认 cwd 是 home,workspace 子目录可能不存在)。
      await sbx.commands.run(`mkdir -p ${E2B_WORKDIR}`);
      return new E2BSandbox(sbx, sbx.sandboxId, commandTimeoutMs);
    } catch (e) {
      await sbx.kill().catch(() => {});
      throw e;
    }
  }

  async runCommand(cmd: string, args: string[] = [], opts: CommandOptions = {}): Promise<CommandResult> {
    const line = [cmd, ...args.map(shellQuote)].join(" ");
    return this.runShell(line, opts);
  }

  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    // e2b commands.run 经 bash 执行 → 支持 && / 管道 / $()。root 用户映射到 { user: "root" },
    // 否则用模板默认(非 root)用户 —— 跨 provider 语义一致(见 types.ts 的 CommandOptions.root)。
    try {
      const res = await this.sbx.commands.run(script, {
        cwd: resolveSandboxPath(this.workdir, opts.cwd),
        envs: opts.env,
        user: opts.root ? "root" : undefined,
        timeoutMs: this.commandTimeoutMs,
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
      });
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    } catch (e) {
      // e2b 在退出码非 0 时【抛】CommandExitError;但 Sandbox 契约要求【返回】带 exitCode 的结果
      // (与 docker / vercel 一致)——否则 agent 命令 / build / 测试一旦非 0 退出就会炸,而不是被判分。
      if (e instanceof CommandExitError) {
        return { stdout: e.stdout, stderr: e.stderr, exitCode: e.exitCode };
      }
      throw e;
    }
  }

  private abs(path: string): string {
    return resolveSandboxPath(this.workdir, path);
  }

  async readFile(path: string): Promise<string> {
    return this.sbx.files.read(this.abs(path), { format: "text" });
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await this.sbx.files.read(this.abs(path), { format: "bytes" });
      return true;
    } catch (error) {
      // 不把瞬时网络/服务错误伪装成“不存在”，交给统一 IO 层重试。
      if (classifySandboxIoError(error) !== "unknown") throw error;
      return false;
    }
  }

  async readSourceFiles(opts: ReadSourceFilesOptions = {}): Promise<SourceFiles> {
    // find 列路径 + 逐文件 files.read —— 与 vercel provider 共用同一两阶段模板。
    return readSourceFilesByList({
      options: opts,
      runShell: (script) => this.runShell(script),
      readOne: (path) => this.sbx.files.read(`${E2B_WORKDIR}/${path}`, { format: "text" }),
    });
  }

  // targetDir 已由 paths.ts 的 normalizeSandboxPaths 解析成绝对路径;这里再解析一次
  // 只是对直接使用 provider 实例(未包 normalize)的幂等防御,提到 map 外只算一次。
  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    const base = resolveSandboxPath(this.workdir, targetDir);
    const entries = Object.entries(files).map(([p, data]) => ({ path: resolveSandboxPath(base, p), data }));
    if (entries.length === 0) return;
    await this.sbx.files.write(entries);
  }

  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    if (files.length === 0) return;
    const base = resolveSandboxPath(this.workdir, targetDir);
    await this.sbx.files.write(
      files.map((f) => ({
        path: resolveSandboxPath(base, f.path),
        data: Buffer.isBuffer(f.content) ? toArrayBuffer(f.content) : f.content,
      })),
    );
  }

  async uploadDirectory(localDir: string, targetDir?: string, opts: { ignore?: string[] } = {}): Promise<void> {
    await this.uploadFiles(await collectLocalFiles(localDir, opts.ignore), targetDir);
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
    const sbx = this.sbx as unknown as { pause?: () => Promise<unknown>; betaPause?: () => Promise<unknown> };
    if (typeof sbx.pause === "function") {
      await sbx.pause();
      return;
    }
    if (typeof sbx.betaPause === "function") {
      await sbx.betaPause();
      return;
    }
    throw new Error("this e2b SDK version has no pause capability; sandbox left running");
  }

  async downloadFile(path: string): Promise<Buffer> {
    const bytes = await this.sbx.files.read(this.abs(path), { format: "bytes" });
    return Buffer.from(bytes);
  }

  async uploadFile(path: string, content: Buffer): Promise<void> {
    await this.sbx.files.write(this.abs(path), toArrayBuffer(content));
  }
}

/** Buffer → ArrayBuffer(e2b files.write 接受 string | ArrayBuffer | Blob | ReadableStream)。 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
