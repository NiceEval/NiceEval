// Vercel Sandbox 后端:用 @vercel/sandbox SDK 把 Vercel microVM 当隔离工作区跑 eval。
// 契约对齐 ../types.ts 的 Sandbox 接口,与 DockerSandbox 可互换。

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Sandbox as VSandbox } from "@vercel/sandbox";
import type {
  Sandbox,
  CommandResult,
  CommandOptions,
  SandboxFile,
  SourceFiles,
  ReadSourceFilesOptions,
} from "../types.ts";
import { makeSourceFiles } from "./source-files.ts";
import { resolveSandboxPath } from "./paths.ts";
import { t } from "../i18n/index.ts";

const DEFAULT_SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx"];
const DEFAULT_IGNORE_DIRS = [".git", ".next", "node_modules", "dist", "build", "coverage"];
const DEFAULT_IGNORE_FILES = ["EVAL.ts", "PROMPT.md"];

// Vercel Sandbox 的默认工作区路径(SDK writeFiles 默认落这里)。
const VERCEL_WORKDIR = "/vercel/sandbox";

// 单条命令的默认超时:设为沙箱 session 生命周期(10 分钟),防止长时间 build/install 被截断。
const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
// Rotate session when it has been alive >270s to stay under the plan cap (~360-390s).
const ROTATE_THRESHOLD_MS = 270_000;
const SESSION_TIMEOUT_MS = 1_200_000;

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
    opts: { timeout?: number; runtime?: "node20" | "node24"; snapshotId?: string } = {},
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
    const id = vsb.currentSession().sessionId;
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
      this.vsb = newVsb;
      this.sessionCreatedAt = Date.now();
      console.error(t("vercel.rotated", {
        seconds: Math.round(elapsed / 1000),
        sessionId: newVsb.currentSession().sessionId,
      }));
    } catch (err) {
      console.error(t("vercel.rotateFailed", {
        seconds: Math.round(elapsed / 1000),
        error: String(err),
      }));
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
    return {
      stdout: await finished.stdout(),
      stderr: await finished.stderr(),
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

  async readSourceFiles(opts: ReadSourceFilesOptions = {}): Promise<SourceFiles> {
    const extensions = opts.extensions ?? DEFAULT_SOURCE_EXTENSIONS;
    const ignoreDirs = opts.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
    const ignoreFiles = new Set(opts.ignoreFiles ?? DEFAULT_IGNORE_FILES);

    // 两阶段读取:Phase 1 只做 find(列路径,NDJSON 流短命令快速结束);
    // Phase 2 逐文件用 readFileToBuffer(独立 HTTP GET,不依赖 NDJSON 流)。
    // 这样即使 session 快到 plan 上限,后半段读取也不会被截断。
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
        const absPath = `${VERCEL_WORKDIR}/${path}`;
        try {
          const buf = await this.vsb.readFileToBuffer({ path: absPath });
          if (buf) files.push({ path, content: buf.toString("utf8") });
        } catch {
          // skip unreadable files (binary, permissions, etc.)
        }
      }),
    );
    return makeSourceFiles(files);
  }

  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    const entries = Object.entries(files).map(([p, content]) => ({
      path: resolveSandboxPath(resolveSandboxPath(this.workdir, targetDir), p),
      content,
    }));
    if (entries.length === 0) return;
    await this.vsb.writeFiles(entries);
  }

  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    if (files.length === 0) return;
    await this.vsb.writeFiles(
      files.map((f) => ({
        path: resolveSandboxPath(resolveSandboxPath(this.workdir, targetDir), f.path),
        content: f.content,
      })),
    );
  }

  async uploadDirectory(localDir: string, targetDir?: string, opts: { ignore?: string[] } = {}): Promise<void> {
    await this.uploadFiles(await collectLocalFiles(localDir, opts.ignore), targetDir);
  }

  async stop(): Promise<void> {
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

async function collectLocalFiles(localDir: string, ignore: readonly string[] = []): Promise<SandboxFile[]> {
  const ignored = new Set(ignore);
  const out: SandboxFile[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir)) {
      if (ignored.has(entry)) continue;
      const abs = join(dir, entry);
      const st = await stat(abs);
      if (st.isDirectory()) {
        await walk(abs);
      } else if (st.isFile()) {
        out.push({
          path: relative(localDir, abs).split(sep).join("/"),
          content: await readFile(abs),
        });
      }
    }
  }
  await walk(localDir);
  return out;
}
