// E2B 沙箱 provider:用 e2b SDK 把 E2B microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox / VercelSandbox 可互换。
//
// 鉴权:E2B_API_KEY(team 级,e2b CLI `e2b auth login` 后也写在 ~/.e2b)。
// 模板:opts.template 选 e2b 模板名/ID;省略用 e2b 默认 "base"。预制模板(烘焙好
//       codex/claude-code/bub 的 "niceeval-agents")见 sandbox/e2b/。

import { Sandbox as E2BSdkSandbox, CommandExitError, RateLimitError } from "e2b";
import type {
  Sandbox,
  CommandResult,
  CommandOptions,
  SandboxFile,
  SourceFiles,
  ReadSourceFilesOptions,
} from "../types.ts";
import type { SandboxProvisionErrorKind } from "./errors.ts";
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
export function classifyProvisionError(e: unknown): SandboxProvisionErrorKind {
  return e instanceof RateLimitError ? "rate_limit" : "unknown";
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
    opts: { timeout?: number; runtime?: "node20" | "node24"; template?: string } = {},
  ): Promise<E2BSandbox> {
    const commandTimeoutMs = opts.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS;
    // e2b 的 node 版本由模板决定,runtime 仅作记录(不在创建时选)。
    const apiKey = process.env.E2B_API_KEY;
    const sdkOpts = { apiKey, timeoutMs: SESSION_TIMEOUT_MS } as const;
    // 有 template 就从模板起,否则用 e2b 默认 "base"。
    const sbx = opts.template
      ? await E2BSdkSandbox.create(opts.template, sdkOpts)
      : await E2BSdkSandbox.create(sdkOpts);
    // 备好工作区目录(模板默认 cwd 是 home,workspace 子目录可能不存在)。
    await sbx.commands.run(`mkdir -p ${E2B_WORKDIR}`);
    return new E2BSandbox(sbx, sbx.sandboxId, commandTimeoutMs);
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
    } catch {
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
