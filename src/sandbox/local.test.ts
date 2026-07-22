// cases: docs/engineering/testing/unit/sandbox.md
// Local provider(docs/feature/sandbox/local.md)的四条声明覆盖:
// - 仓库根解析(省略 dir 时从 cwd 向上找到 git 根,含从子目录起步)与仓库外报错(给出两条出路)
// - 只观察不还原:LocalSandbox 自身的操作不触碰用户真实 .git 的 HEAD/索引,stop() 不删工作树
// - 不提权:{ root: true } 对 runCommand / runShell 都报错,不是静默降级成非 root
// - 与 --keep-sandbox 组合在创建沙箱前报错(与自定义 provider 不支持留存同一形态)
//
// 用真实临时 git 仓库(mkdtemp + git init)当 workdir,不 mock 文件系统或 git——本地档的正确性
// 中心恰恰是「对真实宿主 git 状态的影响为零」,mock 掉 git 就测不出这条。

import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { LocalSandbox } from "./local.ts";
import { localSandbox } from "../define.ts";
import { defineSandboxAgent } from "../define.ts";
import { runAttemptEffect } from "../runner/attempt.ts";
import type { CapturedEvalSource } from "../runner/eval-source.ts";
import type { Attempt, AgentRun, RunOptions } from "../runner/types.ts";
import type { Config, DiscoveredEval } from "../types.ts";

const execFileAsync = promisify(execFile);

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@localhost", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@localhost" },
  });
  return stdout;
}

/** 建一个有一次提交的真实 git 仓库,返回仓库根的 realpath(消解符号链接,便于跨路径比较)。 */
async function makeGitRepo(): Promise<string> {
  const dir = await makeTmpDir("niceeval-local-repo-");
  await git(dir, ["init", "-q"]);
  await writeFile(join(dir, "README.md"), "hello\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "init"]);
  return realpath(dir);
}

describe("LocalSandbox · 仓库根解析与仓库外报错", () => {
  it("省略 dir 时从 cwd 解析到 git 仓库根", async () => {
    const repoRoot = await makeGitRepo();
    const sandbox = await LocalSandbox.create({ cwd: repoRoot });
    expect(await realpath(sandbox.workdir)).toBe(repoRoot);
    await sandbox.stop();
  });

  it("省略 dir 时从仓库内的子目录向上找到同一个仓库根(不是子目录本身)", async () => {
    const repoRoot = await makeGitRepo();
    const nested = join(repoRoot, "src", "nested");
    await mkdir(nested, { recursive: true });
    const sandbox = await LocalSandbox.create({ cwd: nested });
    expect(await realpath(sandbox.workdir)).toBe(repoRoot);
    expect(sandbox.workdir).not.toBe(nested);
    await sandbox.stop();
  });

  it("不在任何 git 仓库内时报错,错误信息给出两条出路(cd 进仓库 / 显式传 dir)", async () => {
    const outside = await makeTmpDir("niceeval-local-outside-");
    await expect(LocalSandbox.create({ cwd: outside })).rejects.toThrow(/localSandbox\(\{ ?dir/);
  });

  it("显式 dir 指向不存在的目录时,创建时第一次如实抛出(不自动创建)", async () => {
    const parent = await makeTmpDir("niceeval-local-missingdir-");
    const missing = join(parent, "does-not-exist");
    await expect(LocalSandbox.create({ dir: missing })).rejects.toThrow(/does not exist/);
    expect(existsSync(missing)).toBe(false);
  });

  it("显式 dir 允许非 git 仓库目录(不要求已 git init)", async () => {
    const plain = await makeTmpDir("niceeval-local-plaindir-");
    const sandbox = await LocalSandbox.create({ dir: plain });
    expect(await realpath(sandbox.workdir)).toBe(await realpath(plain));
    await sandbox.stop();
  });
});

describe("LocalSandbox · 只观察不还原", () => {
  it("agent 侧的文件写入之后,stop() 不删工作树、用户 git 的 HEAD 与未提交状态逐字节不变", async () => {
    const repoRoot = await makeGitRepo();
    const headBefore = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    const statusBefore = await git(repoRoot, ["status", "--porcelain"]);
    expect(statusBefore).toBe(""); // 提交后是干净仓库,作为「不被触碰」的基线。

    const sandbox = await LocalSandbox.create({ dir: repoRoot });
    // 模拟 agent 在 workdir 里落地一个新文件(未提交、未 add)。
    await sandbox.writeFiles({ "agent-output.txt": "agent wrote this\n" });
    expect(await readFile(join(repoRoot, "agent-output.txt"), "utf-8")).toBe("agent wrote this\n");

    const ledgerBase = (sandbox as unknown as { ledgerBase: string }).ledgerBase;
    expect(existsSync(ledgerBase)).toBe(true); // 私有临时目录此刻确实存在,证明下面的删除是 stop() 做的。

    await sandbox.stop();

    // 工作树一个字节不动:agent 写的文件还在,用户仓库的 HEAD 与未提交状态与 stop() 之前完全一致
    // (stop() 不 reset、不 clean)。
    expect(existsSync(join(repoRoot, "agent-output.txt"))).toBe(true);
    expect((await git(repoRoot, ["rev-parse", "HEAD"])).trim()).toBe(headBefore);
    expect(await git(repoRoot, ["status", "--porcelain"])).toBe("?? agent-output.txt\n");
    // 只清 runner 私有资源:分类账的私有临时目录被删掉。
    expect(existsSync(ledgerBase)).toBe(false);
  });
});

describe("LocalSandbox · 不提权", () => {
  it("runCommand({ root: true }) 报错,不静默降级成非 root", async () => {
    const dir = await makeTmpDir("niceeval-local-root-");
    const sandbox = await LocalSandbox.create({ dir });
    await expect(sandbox.runCommand("id", [], { root: true })).rejects.toThrow(/root/i);
    await sandbox.stop();
  });

  it("runShell({ root: true }) 同样报错", async () => {
    const dir = await makeTmpDir("niceeval-local-root-shell-");
    const sandbox = await LocalSandbox.create({ dir });
    await expect(sandbox.runShell("id", { root: true })).rejects.toThrow(/root/i);
    await sandbox.stop();
  });
});

// --keep-sandbox 与 local 组合:与自定义 provider 不支持留存同一形态,在 createSandbox() 之前
// 报清晰错误——runAttemptEffect 的这条前置校验早于任何真实沙箱创建,不需要真实 git 仓库。
describe("runAttemptEffect · --keep-sandbox 与 local provider 组合在创建前报错", () => {
  it("local + keepSandbox 合成一条 errored 结果,不尝试创建任何沙箱", async () => {
    const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };
    const evalDef: DiscoveredEval = {
      id: "fake/eval",
      baseDir: "/project",
      sourcePath: "/project/fake.eval.ts",
      source,
      test: () => {},
    };
    const agent = defineSandboxAgent({ name: "fake-agent", send: async () => ({ events: [], status: "completed" }) });
    const run: AgentRun = {
      agent,
      flags: {},
      runs: 1,
      earlyExit: true,
      sandbox: localSandbox(),
      timeoutMs: 5_000,
      selectedEvalIds: [evalDef.id],
    };
    const attempt: Attempt = { evalDef, run, attempt: 0, key: "fake/eval", fingerprint: "" };
    const config: Config = {};
    const runOpts: RunOptions = {
      config,
      evals: [evalDef],
      agentRuns: [run],
      reporters: [],
      maxConcurrency: 1,
      keepSandbox: "failed",
    };
    const sandboxSem = Effect.runSync(Effect.makeSemaphore(1));
    const result = await Effect.runPromise(runAttemptEffect(attempt, runOpts, sandboxSem));

    expect(result.error?.message).toContain("--keep-sandbox is not supported");
    expect(result.error?.message).toContain("local");
  });
});
