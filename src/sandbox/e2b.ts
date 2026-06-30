// E2B 沙箱后端:用 e2b SDK 把 E2B microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox / VercelSandbox 可互换。
//
// 鉴权:E2B_API_KEY(team 级,e2b CLI `e2b auth login` 后也写在 ~/.e2b)。
// 模板:opts.template 选 e2b 模板名/ID;省略用 e2b 默认 "base"。预制模板(烘焙好
//       codex/claude-code/bub 的 "fasteval-agents")见 sandbox/e2b/。

import { Sandbox as E2BSdkSandbox, CommandExitError } from "e2b";
import type {
  Sandbox,
  CommandResult,
  CommandOptions,
  SandboxFile,
  SourceFiles,
  ReadSourceFilesOptions,
} from "../types.ts";
import { makeSourceFiles } from "./source-files.ts";

const DEFAULT_SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx"];
const DEFAULT_IGNORE_DIRS = [".git", ".next", "node_modules", "dist", "build", "coverage"];
const DEFAULT_IGNORE_FILES = ["EVAL.ts", "PROMPT.md"];

// e2b 默认用户 "user",home 在 /home/user;工作区放其下。
const E2B_WORKDIR = "/home/user/workspace";

// 单条命令默认超时(10 分钟),防止长跑的 build/install 被截断。
const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
// 沙箱存活上限(到点 e2b 自动回收)。给足空间跑完 setup + agent + 测试脚本。
const SESSION_TIMEOUT_MS = 1_800_000;

/** 单引号包裹 + 转义,把一个参数安全嵌进 shell 命令串。 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export class E2BSandbox implements Sandbox {
  readonly otlpHost = null;
  private sbx: E2BSdkSandbox;
  private workDir: string = E2B_WORKDIR;
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
    // 否则用模板默认(非 root)用户 —— 跨后端语义一致(见 types.ts 的 CommandOptions.root)。
    try {
      const res = await this.sbx.commands.run(script, {
        cwd: opts.cwd ?? this.workDir,
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
    return path.startsWith("/") ? path : `${this.workDir}/${path}`;
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
    const extensions = opts.extensions ?? DEFAULT_SOURCE_EXTENSIONS;
    const ignoreDirs = opts.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
    const ignoreFiles = new Set(opts.ignoreFiles ?? DEFAULT_IGNORE_FILES);

    // 一次 find 列路径,再逐文件 files.read —— 与 vercel 后端同形。
    const dirPrune = ignoreDirs.map((d) => `-name '${d}'`).join(" -o ");
    const nameTests = extensions.map((e) => `-name '*.${e}'`).join(" -o ");
    const listScript = `find . \\( -type d \\( ${dirPrune} \\) \\) -prune -o -type f \\( ${nameTests} \\) -print`;
    const result = await this.runShell(listScript);

    const paths = result.stdout
      .trim()
      .split("\n")
      .map((p) => p.trim().replace(/^\.\//, ""))
      .filter((p) => p && !ignoreFiles.has(p.split("/").at(-1) ?? ""));

    const files: { path: string; content: string }[] = [];
    await Promise.all(
      paths.map(async (path) => {
        try {
          const content = await this.sbx.files.read(`${this.workDir}/${path}`, { format: "text" });
          files.push({ path, content });
        } catch {
          // skip unreadable files (binary, permissions, etc.)
        }
      }),
    );
    return makeSourceFiles(files);
  }

  async writeFiles(files: Record<string, string>): Promise<void> {
    const entries = Object.entries(files).map(([p, data]) => ({ path: this.abs(p), data }));
    if (entries.length === 0) return;
    await this.sbx.files.write(entries);
  }

  async uploadFiles(files: SandboxFile[]): Promise<void> {
    if (files.length === 0) return;
    await this.sbx.files.write(
      files.map((f) => ({
        path: this.abs(f.path),
        data: Buffer.isBuffer(f.content) ? toArrayBuffer(f.content) : f.content,
      })),
    );
  }

  getWorkingDirectory(): string {
    return this.workDir;
  }

  setWorkingDirectory(path: string): void {
    this.workDir = path;
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
