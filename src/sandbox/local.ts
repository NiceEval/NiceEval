// Local 沙箱 provider:宿主机本地目录直接当 workdir 跑,零隔离、零仪式
// (契约见 docs/feature/sandbox/local.md)。runCommand 按 argv 直接 spawn 宿主进程(不经 shell);
// runShell 交给宿主 bash(与其它 provider 的 runShell 语义一致);文件 IO 走本地 fs——
// 「沙箱」就是宿主文件系统本身,没有远端控制面、没有预制环境、没有留存。
//
// 变更分类账的 GIT_DIR 不能像其它 provider 那样固定在同一个宿主路径:多数 provider 每次创建都是
// 全新隔离文件系统,固定路径天然不冲突;本地档的"沙箱"是宿主机本身,同机先后或并发跑的多个
// attempt 共享同一个 /tmp,固定路径会在多次运行之间互相踩踏用户看不到的 git 索引。这里改用
// mkdtemp 出的每实例私有目录,经 sandbox/ledger-paths.ts 登记给 runner/ledger.ts 消费——
// ledger.ts 不需要认识"local"这个名字,只需要知道"这个 sandboxId 有没有登记覆盖路径"。

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, readFile as fsReadFile, writeFile as fsWriteFile, access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";
import type { CommandOptions, CommandResult, Sandbox, SandboxFile } from "../types.ts";
import { resolveSandboxPath } from "./paths.ts";
import { collectLocalFiles } from "./local-files.ts";
import { downloadDirectoryByList } from "./download-directory.ts";
import { registerLedgerPaths, unregisterLedgerPaths } from "./ledger-paths.ts";
import { t } from "../i18n/index.ts";

const execFileAsync = promisify(execFile);

/** 单条命令默认超时(10 分钟),与其它内置 provider 的默认值一致。 */
const DEFAULT_TIMEOUT = 600_000;

export interface LocalSandboxOptions {
  /** 显式 workdir;省略时从当前目录向上解析 git 仓库根。 */
  dir?: string;
  /** 单条命令超时(毫秒)。 */
  timeout?: number;
  /**
   * 内部测试用:覆盖「当前目录」的解析起点(省略 `dir` 时向上找 git 根、显式 `dir` 时的相对路径
   * 基准都从它算)。生产路径(resolve.ts 的 `createProvider()`)从不传这个字段,恒用
   * `process.cwd()`——不是公开 spec 的一部分,`localSandbox()` 工厂不暴露它。
   */
  cwd?: string;
}

/** 从给定目录向上解析 git 仓库根;不在任何 git 仓库内时给出两条出路。 */
async function resolveGitRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    throw new Error(t("local.notARepo"));
  }
}

/** 显式 dir:相对路径按 cwd 解析;必须已存在且可写(不自动创建)。 */
async function resolveExplicitDir(dir: string, cwd: string): Promise<string> {
  const abs = resolvePath(cwd, dir);
  try {
    await access(abs, fsConstants.W_OK);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") throw new Error(t("local.dirMissing", { dir: abs }));
    throw new Error(t("local.dirNotWritable", { dir: abs, message: err.message }));
  }
  const info = await stat(abs);
  if (!info.isDirectory()) throw new Error(t("local.dirNotWritable", { dir: abs, message: "not a directory" }));
  return abs;
}

async function resolveWorkdir(dir: string | undefined, cwd: string): Promise<string> {
  return dir !== undefined ? resolveExplicitDir(dir, cwd) : resolveGitRoot(cwd);
}

interface SpawnOpts {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  onStdout?: CommandOptions["onStdout"];
  onStderr?: CommandOptions["onStderr"];
}

/** argv 直接 spawn(不经 shell)与「bash -c script」共用的执行核心。 */
function runSpawned(command: string, args: string[], opts: SpawnOpts): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    // detached(POSIX):超时时能杀掉整个进程组,不只是直接子进程——agent 命令常常自己再
    // 起子进程(npm 脚本、shell 管道),只杀顶层容易留下孤儿。Windows 没有进程组这个概念,
    // 退化成直接 kill 顶层进程。
    const posix = process.platform !== "win32";
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, detached: posix });
    let stdout = "";
    let stderr = "";
    let callbackChain = Promise.resolve();
    let settled = false;

    const timer = setTimeout(() => {
      if (posix && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
    }, opts.timeout);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stdout += text;
      if (opts.onStdout) callbackChain = callbackChain.then(() => opts.onStdout!(text));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderr += text;
      if (opts.onStderr) callbackChain = callbackChain.then(() => opts.onStderr!(text));
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callbackChain
        .then(() => {
          if (signal === "SIGKILL" && code === null) {
            reject(new Error(t("local.commandTimeout", { timeoutMs: opts.timeout })));
            return;
          }
          resolvePromise({ stdout, stderr, exitCode: code ?? 0 });
        })
        .catch(reject);
    });
  });
}

/**
 * Local 沙箱:宿主机的一个本地目录。实现 ../types.ts 的 Sandbox 接口。
 * 契约见 docs/feature/sandbox/local.md;实现要点见 docs/feature/sandbox/architecture.md
 * 「Local provider(宿主机,零隔离)」。
 */
export class LocalSandbox implements Sandbox {
  readonly workdir: string;
  readonly otlpHost = "localhost";
  readonly sandboxId: string;
  private readonly timeout: number;
  private readonly ledgerBase: string;

  private constructor(workdir: string, ledgerBase: string, timeout: number) {
    this.workdir = workdir;
    this.ledgerBase = ledgerBase;
    this.timeout = timeout;
    this.sandboxId = `local-${randomUUID().slice(0, 8)}`;
  }

  /** 解析 workdir + 备好变更分类账的私有临时目录(不参与 provisioning 重试,见 resolve.ts)。 */
  static async create(options: LocalSandboxOptions = {}): Promise<LocalSandbox> {
    const workdir = await resolveWorkdir(options.dir, options.cwd ?? process.cwd());
    const ledgerBase = await mkdtemp(join(tmpdir(), "niceeval-local-ledger-"));
    const sandbox = new LocalSandbox(workdir, ledgerBase, options.timeout ?? DEFAULT_TIMEOUT);
    // runner/ledger.ts 按 sandboxId 读取这份登记——本地档的"沙箱"是宿主机本身,固定的宿主路径
    // 会在同机多次运行之间互相踩踏,每实例必须有自己的一份(见文件头注释)。
    registerLedgerPaths(sandbox.sandboxId, {
      gitDir: join(ledgerBase, "ledger.git"),
      exportDir: join(ledgerBase, "export"),
    });
    return sandbox;
  }

  async runCommand(cmd: string, args: string[] = [], opts: CommandOptions = {}): Promise<CommandResult> {
    if (opts.root) throw new Error(t("local.rootUnsupported"));
    return runSpawned(cmd, args, {
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      env: { ...process.env, ...opts.env },
      timeout: this.timeout,
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
    });
  }

  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    if (opts.root) throw new Error(t("local.rootUnsupported"));
    return runSpawned("bash", ["-c", script], {
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      env: { ...process.env, ...opts.env },
      timeout: this.timeout,
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
    });
  }

  async readFile(path: string): Promise<string> {
    return fsReadFile(resolveSandboxPath(this.workdir, path), "utf-8");
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await access(resolveSandboxPath(this.workdir, path));
      return true;
    } catch {
      return false;
    }
  }

  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    const sandboxFiles: SandboxFile[] = Object.entries(files).map(([path, content]) => ({
      path,
      content: Buffer.from(content, "utf-8"),
    }));
    await this.uploadFiles(sandboxFiles, targetDir);
  }

  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    const target = resolveSandboxPath(this.workdir, targetDir);
    for (const file of files) {
      const dest = resolveSandboxPath(target, file.path);
      await mkdir(dirname(dest), { recursive: true });
      await fsWriteFile(dest, typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : file.content);
    }
  }

  async uploadDirectory(localDir: string, targetDir?: string, opts: { ignore?: string[] } = {}): Promise<void> {
    const files = await collectLocalFiles(localDir, opts.ignore);
    await this.uploadFiles(files, targetDir);
  }

  async downloadFile(path: string): Promise<Buffer> {
    return fsReadFile(resolveSandboxPath(this.workdir, path));
  }

  async uploadFile(path: string, content: Buffer): Promise<void> {
    const dest = resolveSandboxPath(this.workdir, path);
    await mkdir(dirname(dest), { recursive: true });
    await fsWriteFile(dest, content);
  }

  /**
   * 与 vercel/e2b 共用同一套「find 列路径 + 逐文件读取」模板(见 download-directory.ts):
   * 复用是为了让 ignore 的 basename 剪除语义与落盘行为在三个 provider 间保持逐字节一致,
   * 不是本地档做不了更直接的 fs 递归拷贝——用同一份实现,行为差异这个物种直接不存在。
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

  /**
   * 只清 runner 私有资源(分类账的私有 GIT_DIR 临时目录),不动工作树任何文件——本地档从不
   * 销毁"沙箱",因为宿主机本身不是可销毁的资源(见 docs/feature/sandbox/local.md「只观察,不还原」)。
   */
  async stop(): Promise<void> {
    unregisterLedgerPaths(this.sandboxId);
    await rm(this.ledgerBase, { recursive: true, force: true }).catch(() => {});
  }
}
