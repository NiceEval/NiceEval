// cases: docs/engineering/testing/unit/sandbox.md
// 变更分类账的集成测试:用宿主 shell 扮演沙箱(真实 git),验证
// - .git 不在 workdir 内(agent 看不到分类账;eval 自己 git init 不冲突)
// - eval 归因(send 前写入)不进 agent diff;send 窗口内写入逐窗口归因
// - 排除清单(默认 + ignore)与 include 打洞
// - 「创建又删除」「改回原样」净效果为 none,但触及窗口仍留痕(fileChanged 语义)

import { afterEach, describe, expect, it } from "vitest";
import { exec } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile, mkdir, readdir, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createChangeLedger } from "./ledger.ts";
import { deriveDiffData, elidedContentAt, elidedContentPaths } from "../assertions/diff.ts";
import {
  noSandboxBackendCapabilities,
  registerSandboxCapabilities,
  supportedBackendCapability,
} from "../sandbox/backend.ts";
import type { CommandOptions, CommandResult, Sandbox } from "../types.ts";

const execAsync = promisify(exec);

/** 宿主目录扮演沙箱 workdir;runShell 用真实 shell 跑,readBytes 读宿主文件(ledger 只用这两个 + env)。 */
function hostSandbox(
  workdir: string,
  ledgerDir: string,
  counters?: { shells?: string[]; shellOptions?: CommandOptions[]; downloads?: string[] },
): Sandbox {
  // 把 ledger 的固定 /tmp 路径前缀重定向到本测试的私有目录,测试之间互不污染
  // (导出目录 /tmp/.niceeval-ledger-export 共享同一前缀,一条规则同时覆盖)。
  const patchPath = (s: string) => s.replaceAll("/tmp/.niceeval-ledger", ledgerDir);
  const runShell = async (script: string, opts: CommandOptions = {}): Promise<CommandResult> => {
    counters?.shells?.push(script);
    counters?.shellOptions?.push(opts);
    const env = { ...process.env, ...opts?.env };
    if (env.GIT_DIR === "/tmp/.niceeval-ledger") env.GIT_DIR = ledgerDir;
    try {
      const { stdout, stderr } = await execAsync(patchPath(script), { cwd: workdir, env, maxBuffer: 64 * 1024 * 1024 });
      return { stdout, stderr, exitCode: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? 1 };
    }
  };
  const readBytes = async (path: string): Promise<Uint8Array> => {
    counters?.downloads?.push(path);
    return Buffer.from(await readFile(patchPath(path)));
  };
  return {
    workdir,
    sandboxId: "host-test",
    otlpHost: null,
    runShell,
    runCommand: async () => {
      throw new Error("not used");
    },
    runCommandOrThrow: async () => {
      throw new Error("not used");
    },
    runShellOrThrow: async () => {
      throw new Error("not used");
    },
    readText: async () => "",
    writeText: async () => {},
    readBytes,
    writeBytes: async () => {},
    pathExists: async () => false,
    uploadDirectory: async () => {},
    uploadFile: async () => {},
    downloadFile: async () => {},
    downloadDirectory: async () => {
      throw new Error("not used");
    },
    stop: async () => {},
  } as unknown as Sandbox;
}

/** 宿主测试进程没有提权能力；短暂放开读位模拟 provider 的 root command，再恢复原 mode。 */
function rootCapableHostSandbox(
  workdir: string,
  ledgerDir: string,
  restrictedPath: string,
  counters: { shells: string[]; shellOptions: CommandOptions[]; downloads: string[] },
): Sandbox {
  const base = hostSandbox(workdir, ledgerDir, counters);
  const sandbox = {
    ...base,
    async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
      if (opts.root !== true) return base.runShell(script, opts);
      const original = await stat(restrictedPath);
      await chmod(restrictedPath, 0o755);
      try {
        return await base.runShell(script, opts);
      } finally {
        await chmod(restrictedPath, original.mode & 0o777);
      }
    },
  } as Sandbox;
  registerSandboxCapabilities(sandbox, {
    ...noSandboxBackendCapabilities,
    rootCommands: supportedBackendCapability(true as const),
  });
  return sandbox;
}

let roots: string[] = [];
async function makeDirs(): Promise<{ workdir: string; ledgerDir: string }> {
  const base = await mkdtemp(join(tmpdir(), "niceeval-ledger-"));
  roots.push(base);
  const workdir = join(base, "work");
  await mkdir(workdir, { recursive: true });
  return { workdir, ledgerDir: join(base, "ledger") };
}

afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

describe("createChangeLedger", () => {
  // bug: memory/ledger-root-read-restricted-workspace-files.md
  it("root-capable provider 读取 mode 0311 文件建立与导出 ledger，不改变 workdir owner/mode", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const restrictedPath = join(workdir, "collect_data.sh");
    await writeFile(restrictedPath, "#!/bin/sh\necho collected\n");
    await chmod(restrictedPath, 0o311);
    const before = await stat(restrictedPath);
    const counters = { shells: [] as string[], shellOptions: [] as CommandOptions[], downloads: [] as string[] };
    const sandbox = rootCapableHostSandbox(workdir, ledgerDir, restrictedPath, counters);

    const ledger = await createChangeLedger(sandbox);
    await ledger.commitAgentWindow("turn1");
    await expect(ledger.exportWindows()).resolves.toEqual([{ window: "turn1", changes: {} }]);

    const after = await stat(restrictedPath);
    expect(after.uid).toBe(before.uid);
    expect(after.gid).toBe(before.gid);
    expect(after.mode & 0o777).toBe(0o311);
    expect(counters.shellOptions).toHaveLength(4);
    expect(counters.shells[0]).toBe("command -p id -u");
    expect(counters.shellOptions[0]?.root).not.toBe(true);
    expect(counters.shellOptions.slice(1).every((options) => options.root === true)).toBe(true);
    expect(counters.downloads).toEqual(["/tmp/.niceeval-ledger-export/export.bin"]);
  });

  it("root-capable provider 接管预创建的 ledger symlink，且不跟随删除其目标", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const restrictedPath = join(workdir, "collect_data.sh");
    await writeFile(restrictedPath, "#!/bin/sh\necho collected\n");
    await chmod(restrictedPath, 0o311);
    const attackerTarget = join(ledgerDir, "..", "attacker-owned-ledger-target");
    await mkdir(attackerTarget);
    await writeFile(join(attackerTarget, "sentinel"), "keep\n");
    await symlink(attackerTarget, ledgerDir);
    const counters = { shells: [] as string[], shellOptions: [] as CommandOptions[], downloads: [] as string[] };

    await createChangeLedger(rootCapableHostSandbox(workdir, ledgerDir, restrictedPath, counters));

    expect((await stat(ledgerDir)).isDirectory()).toBe(true);
    expect((await stat(ledgerDir)).mode & 0o077).toBe(0);
    await expect(readFile(join(attackerTarget, "sentinel"), "utf8")).resolves.toBe("keep\n");
    const anchorScript = counters.shells.find((script) => script.includes("git init -q"));
    expect(anchorScript).toContain("rm -rf --");
    expect(anchorScript).toContain("mkdir -p -m 0700 --");
  });

  it("root-capable ledger 回锚后按私有 metadata 恢复普通文件 ownership/mode，且对象库始终私有", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const restrictedPath = join(workdir, "collect_data.sh");
    const editablePath = join(workdir, "app.ts");
    await writeFile(restrictedPath, "#!/bin/sh\necho collected\n");
    await chmod(restrictedPath, 0o311);
    const restrictedBefore = await stat(restrictedPath);
    await writeFile(editablePath, "export const value = 1;\n");
    const before = await stat(editablePath);
    const counters = { shells: [] as string[], shellOptions: [] as CommandOptions[], downloads: [] as string[] };
    const sandbox = rootCapableHostSandbox(workdir, ledgerDir, restrictedPath, counters);
    const ledger = await createChangeLedger(sandbox);

    await rm(editablePath);
    await ledger.commitAgentWindow("turn1");
    await ledger.resetToAnchor();

    await expect(readFile(editablePath, "utf8")).resolves.toBe("export const value = 1;\n");
    const after = await stat(editablePath);
    expect(after.uid).toBe(before.uid);
    expect(after.gid).toBe(before.gid);
    expect(after.mode & 0o777).toBe(before.mode & 0o777);
    const restrictedAfter = await stat(restrictedPath);
    expect(restrictedAfter.uid).toBe(restrictedBefore.uid);
    expect(restrictedAfter.gid).toBe(restrictedBefore.gid);
    expect(restrictedAfter.mode & 0o777).toBe(0o311);

    const resetAt = counters.shells.findIndex((script) => script.includes("git reset -q --hard"));
    expect(resetAt).toBeGreaterThanOrEqual(0);
    expect(counters.shellOptions.filter((_options, index) => counters.shells[index] !== "command -p id -u")
      .every((options) => options.root === true)).toBe(true);
    expect(counters.shellOptions[counters.shells.indexOf("command -p id -u")]?.root).not.toBe(true);
    const anchorScript = counters.shells.find((script) => script.includes('git commit -q --allow-empty -m "anchor"'));
    expect(anchorScript).toContain("niceeval-baseline-metadata");
    expect(anchorScript).toContain('chmod go-rwx "$GIT_DIR"');
    expect(anchorScript).not.toContain('chmod -R go-rwx "$GIT_DIR"');
    expect(counters.shells[resetAt]).toContain("niceeval-meta-restore");
    expect(counters.shellOptions[resetAt]?.env).toMatchObject({
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/dev/null",
    });
  });

  it("root reset 后 metadata 恢复失败会使 reuse 上抛，不会静默留下错误 ownership", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const restrictedPath = join(workdir, "collect_data.sh");
    await writeFile(restrictedPath, "#!/bin/sh\necho collected\n");
    await chmod(restrictedPath, 0o311);
    const counters = { shells: [] as string[], shellOptions: [] as CommandOptions[], downloads: [] as string[] };
    const sandbox = rootCapableHostSandbox(workdir, ledgerDir, restrictedPath, counters);
    const originalRunShell = sandbox.runShell.bind(sandbox);
    sandbox.runShell = async (script, options = {}) => {
      if (script.includes("niceeval-meta-restore")) {
        counters.shells.push(script);
        counters.shellOptions.push(options);
        return {
          stdout: "",
          stderr: "error: unable to unlink old 'root-owned.txt': Permission denied\n",
          exitCode: 1,
        };
      }
      return originalRunShell(script, options);
    };
    const ledger = await createChangeLedger(sandbox);

    await expect(ledger.resetToAnchor()).rejects.toThrow(
      /reset reusable sandbox.*provider declared root command support.*could not read the workspace/,
    );
    const restoreOptions = counters.shellOptions.filter((_options, index) =>
      counters.shells[index]?.includes("niceeval-meta-restore")
    );
    expect(restoreOptions).toHaveLength(1);
    expect(restoreOptions[0]?.root).toBe(true);
  });

  it("root-capable reset 可恢复 file 与 directory 的双向替换", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const restrictedPath = join(workdir, "collect_data.sh");
    await writeFile(restrictedPath, "#!/bin/sh\necho collected\n");
    await chmod(restrictedPath, 0o311);
    await writeFile(join(workdir, "file-to-dir"), "anchor file\n");
    await mkdir(join(workdir, "dir-to-file"));
    await writeFile(join(workdir, "dir-to-file", "anchor.txt"), "anchor child\n");
    const counters = { shells: [] as string[], shellOptions: [] as CommandOptions[], downloads: [] as string[] };
    const ledger = await createChangeLedger(rootCapableHostSandbox(workdir, ledgerDir, restrictedPath, counters));

    await rm(join(workdir, "file-to-dir"));
    await mkdir(join(workdir, "file-to-dir"));
    await writeFile(join(workdir, "file-to-dir", "agent.txt"), "agent child\n");
    await rm(join(workdir, "dir-to-file"), { recursive: true });
    await writeFile(join(workdir, "dir-to-file"), "agent file\n");
    await ledger.commitAgentWindow("replace-types");
    await ledger.resetToAnchor();

    await expect(readFile(join(workdir, "file-to-dir"), "utf8")).resolves.toBe("anchor file\n");
    await expect(readFile(join(workdir, "dir-to-file", "anchor.txt"), "utf8")).resolves.toBe("anchor child\n");
    expect(counters.shells.some((script) => script.includes("git reset -q --hard"))).toBe(true);
  });

  it("普通执行身份本身为 root 时拒绝跨 attempt 复用私有对象库", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const restrictedPath = join(workdir, "collect_data.sh");
    await writeFile(restrictedPath, "#!/bin/sh\necho collected\n");
    await chmod(restrictedPath, 0o311);
    const counters = { shells: [] as string[], shellOptions: [] as CommandOptions[], downloads: [] as string[] };
    const sandbox = rootCapableHostSandbox(workdir, ledgerDir, restrictedPath, counters);
    const originalRunShell = sandbox.runShell.bind(sandbox);
    sandbox.runShell = async (script, options = {}) => {
      if (script === "command -p id -u" && options.root !== true) {
        counters.shells.push(script);
        counters.shellOptions.push(options);
        return { stdout: "0\n", stderr: "", exitCode: 0 };
      }
      return originalRunShell(script, options);
    };
    const ledger = await createChangeLedger(sandbox);

    await expect(ledger.resetToAnchor()).rejects.toThrow(
      /cannot safely reuse a root-agent sandbox.*private ledger objects.*non-root execution user/,
    );
    expect(counters.shells.some((script) => script.includes("git reset -q --hard"))).toBe(false);
  });

  it("不支持 root 的 provider 遇受限文件时点明能力边界，不建议改坏题目条件", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const base = hostSandbox(workdir, ledgerDir);
    const sandbox = {
      ...base,
      runShell: async (): Promise<CommandResult> => ({
        stdout: "",
        stderr: 'error: open("collect_data.sh"): Permission denied\nfatal: adding files failed\n',
        exitCode: 128,
      }),
    } as Sandbox;

    await expect(createChangeLedger(sandbox)).rejects.toThrow(
      /collect_data\.sh.*does not support root ledger commands.*instead of chmod\/chowning away the task condition/,
    );
  });

  it("锚点后 workdir 素净(无 .git);逐窗口归因,eval 侧写入不进 agent diff", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    await writeFile(join(workdir, "start.txt"), "fixture\n");
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);

    // workdir 保持素净:分类账的 git 目录在 workdir 外。
    expect(await readdir(workdir)).not.toContain(".git");

    // eval 侧写入(send 前):进 eval 归因,不进 agent diff。
    await writeFile(join(workdir, "fixture.json"), "{}\n");
    await ledger.commitEvalWindow("turn1");

    // 窗口 1:agent 改 start.txt、新建 out.txt。
    await writeFile(join(workdir, "start.txt"), "changed by agent\n");
    await writeFile(join(workdir, "out.txt"), "hello\n");
    await writeFile(join(workdir, "with space.txt"), "space-safe\n");
    await writeFile(join(workdir, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await ledger.commitAgentWindow("turn1");

    // 窗口间 eval 写入(隐藏校验文件):不得计入任何 agent 窗口。
    await writeFile(join(workdir, "hidden-check.txt"), "verify\n");
    await ledger.commitEvalWindow("turn2");

    // 窗口 2:agent 删除 out.txt(创建又删除 → 净 none,但两个窗口都留痕)。
    await rm(join(workdir, "out.txt"));
    await ledger.commitAgentWindow("turn2");

    const windows = await ledger.exportWindows();
    expect(windows.map((w) => w.window)).toEqual(["turn1", "turn2"]);
    expect(windows[0]!.changes["start.txt"]).toMatchObject({ status: "modified", after: "changed by agent\n" });
    expect(windows[0]!.changes["out.txt"]).toMatchObject({ status: "added", after: "hello\n" });
    expect(windows[0]!.changes["with space.txt"]).toMatchObject({ status: "added", after: "space-safe\n" });
    expect(windows[0]!.changes["binary.bin"]).toEqual({ status: "added", elided: { reason: "binary", afterBytes: 4 } });
    expect(windows[0]!.changes["fixture.json"]).toBeUndefined();
    expect(windows[1]!.changes["out.txt"]).toMatchObject({ status: "deleted", before: "hello\n" });
    expect(windows[1]!.changes["hidden-check.txt"]).toBeUndefined();

    const diff = deriveDiffData(windows);
    // fileChanged 语义:任一窗口触及即算发生过;net=none(创建又删除)仍留痕。
    expect(diff.files["out.txt"]).toEqual({ net: "none", windows: ["turn1", "turn2"] });
    expect(diff.files["start.txt"]).toEqual({ net: "modified", windows: ["turn1"] });
    expect(diff.get("start.txt")).toBe("changed by agent\n");
    expect(diff.get("out.txt")).toBeUndefined();
  });

  it("复用 reset 回到锚点，保留默认排除的动态依赖", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    await writeFile(join(workdir, "app.ts"), "export const value = 1;\n");
    await mkdir(join(workdir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(workdir, "node_modules", "pkg", "cache.js"), "cached\n");
    const ledger = await createChangeLedger(hostSandbox(workdir, ledgerDir));

    await writeFile(join(workdir, "app.ts"), "export const value = 2;\n");
    await writeFile(join(workdir, "attempt-only.txt"), "remove me\n");
    await ledger.commitAgentWindow("turn1");
    await ledger.resetToAnchor();

    await expect(readFile(join(workdir, "app.ts"), "utf8")).resolves.toBe("export const value = 1;\n");
    await expect(readFile(join(workdir, "attempt-only.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(join(workdir, "node_modules", "pkg", "cache.js"), "utf8")).resolves.toBe("cached\n");
  });

  it("连续复用在私有 metadata 回锚后不把上一轮 agent window 带进下一轮", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    await writeFile(join(workdir, "app.ts"), "baseline\n");
    const ledger = await createChangeLedger(hostSandbox(workdir, ledgerDir));

    await writeFile(join(workdir, "app.ts"), "first attempt\n");
    await ledger.commitAgentWindow("attempt-1");
    await expect(ledger.exportWindows()).resolves.toMatchObject([{ window: "attempt-1" }]);
    await ledger.resetToAnchor();

    await expect(readFile(join(workdir, "app.ts"), "utf8")).resolves.toBe("baseline\n");
    await ledger.commitAgentWindow("attempt-2");
    await expect(ledger.exportWindows()).resolves.toEqual([{ window: "attempt-2", changes: {} }]);
  });

  it("eval 可以在 workdir 自己 git init,不与分类账冲突;agent 的 .git 不进归因", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);

    // eval 在 workdir 里建真实 git repo(agent 视角的项目仓库)。
    await execAsync('git init -q && git config user.email t@t && git config user.name t', { cwd: workdir });
    await ledger.commitEvalWindow("turn1");

    await writeFile(join(workdir, "app.ts"), "export {};\n");
    await ledger.commitAgentWindow("turn1");

    const windows = await ledger.exportWindows();
    expect(Object.keys(windows[0]!.changes)).toEqual(["app.ts"]);
  });

  it("项目 .gitignore 不参与归因(被 ignore 的文件照常记录);默认排除 + ignore + include 打洞", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    // secret/ 追加排除;node_modules/keep.js 显式加回。
    const ledger = await createChangeLedger(sandbox, { ignore: ["secret"], include: ["node_modules/keep.js"] });

    // agent 写 .gitignore 忽略 output.txt:影响不了分类账(项目 ignore 不参与归因)。
    await writeFile(join(workdir, ".gitignore"), "output.txt\n");
    await writeFile(join(workdir, "output.txt"), "ignored by project, recorded by ledger\n");
    await mkdir(join(workdir, "node_modules"), { recursive: true });
    await writeFile(join(workdir, "node_modules", "dep.js"), "excluded\n");
    await writeFile(join(workdir, "node_modules", "keep.js"), "included back\n");
    await mkdir(join(workdir, "packages/app/node_modules/dep"), { recursive: true });
    await writeFile(join(workdir, "packages/app/node_modules/dep/index.js"), "nested dependency\n");
    await mkdir(join(workdir, "packages/app/__pycache__"), { recursive: true });
    await writeFile(join(workdir, "packages/app/__pycache__/mod.pyc"), "nested cache\n");
    await mkdir(join(workdir, "secret"), { recursive: true });
    await writeFile(join(workdir, "secret", "token.txt"), "excluded via ignore\n");
    // Python 工具链目录不依赖项目 .gitignore:任意 *venv*/ 名字都由 runner 私有清单排除。
    for (const dir of ["venv", ".venv", ".testing-venv", "tools/pypi-venv"]) {
      await mkdir(join(workdir, dir), { recursive: true });
      await writeFile(join(workdir, dir, "dependency.py"), "excluded virtualenv dependency\n");
    }
    await ledger.commitAgentWindow("turn1");

    const windows = await ledger.exportWindows();
    const paths = Object.keys(windows[0]!.changes).sort();
    expect(paths).toContain("output.txt");
    expect(paths).toContain("node_modules/keep.js");
    expect(paths).not.toContain("node_modules/dep.js");
    expect(paths).not.toContain("packages/app/node_modules/dep/index.js");
    expect(paths).not.toContain("packages/app/__pycache__/mod.pyc");
    expect(paths).not.toContain("secret/token.txt");
    expect(paths.some((path) => path.includes("venv"))).toBe(false);
  });

  // bug: memory/ledger-gitignore-pathspec-and-gitlinks.md
  it("未排除的 nested repo 明确失败；整目录 ignore 后允许作为无关环境存在", async () => {
    const first = await makeDirs();
    const checkout = join(first.workdir, "checkout");
    await mkdir(checkout, { recursive: true });
    await execAsync("git init -q && git config user.email t@t && git config user.name t", { cwd: checkout });
    await writeFile(join(checkout, "app.py"), "print('hello')\n");
    await execAsync("git add app.py && git commit -qm baseline", { cwd: checkout });

    await expect(createChangeLedger(hostSandbox(first.workdir, first.ledgerDir))).rejects.toThrow(
      /nested Git repository checkout.*sandbox\.workdir root.*diff.*ignore/,
    );

    const second = await makeDirs();
    const ignoredCheckout = join(second.workdir, "checkout");
    await mkdir(ignoredCheckout, { recursive: true });
    await execAsync("git init -q && git config user.email t@t && git config user.name t", { cwd: ignoredCheckout });
    await writeFile(join(ignoredCheckout, "app.py"), "print('ignored')\n");
    await execAsync("git add app.py && git commit -qm baseline", { cwd: ignoredCheckout });

    await expect(createChangeLedger(hostSandbox(second.workdir, second.ledgerDir), { ignore: ["checkout/"] })).resolves.toBeDefined();
  });

  it("整相导出只用一条 shell 命令 + 一次文件下载,不随文件数与窗口数增长", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const counters = { shells: [] as string[], downloads: [] as string[] };
    const sandbox = hostSandbox(workdir, ledgerDir, counters);
    const ledger = await createChangeLedger(sandbox);
    await mkdir(join(workdir, "generated"), { recursive: true });
    await Promise.all(
      Array.from({ length: 500 }, (_, i) => writeFile(join(workdir, "generated", `${i}.txt`), `file ${i}\n`)),
    );
    await ledger.commitAgentWindow("turn1");
    await writeFile(join(workdir, "second.txt"), "second window\n");
    await ledger.commitAgentWindow("turn2");

    const beforeExport = counters.shells.length;
    const windows = await ledger.exportWindows();

    // 全部窗口一条沙箱内命令导出 + 一次导出文件下载;不随 500 个文件或窗口数增长。
    expect(counters.shells.length - beforeExport).toBe(1);
    expect(counters.downloads).toHaveLength(1);
    expect(windows).toHaveLength(2);
    expect(Object.keys(windows[0]!.changes)).toHaveLength(500);
    expect(windows[0]!.changes["generated/499.txt"]).toEqual({ status: "added", after: "file 499\n" });
    expect(windows[1]!.changes).toEqual({ "second.txt": { status: "added", after: "second window\n" } });
  });

  it("单窗口超过路径上限时明确失败,不伪造成空 diff", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);
    await mkdir(join(workdir, "generated"), { recursive: true });
    await Promise.all(
      Array.from({ length: 10_001 }, (_, i) => writeFile(join(workdir, "generated", `${i}.txt`), "")),
    );
    await ledger.commitAgentWindow("turn1");

    await expect(ledger.exportWindows()).rejects.toThrow("contains 10001 paths; limit is 10000");
  }, 30_000);

  it("单窗口要传输的文本字节超上限时明确失败,尺寸核算先于内容传输", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);
    // 65 个正好 1 MiB 的文本文件(内容各不相同,不被 git 按 blob 去重):每个都没超单文件阈值
    // → 全都要传输 → 65 MiB > 64 MiB 预算。
    await mkdir(join(workdir, "text"), { recursive: true });
    for (let i = 0; i < 65; i++) {
      await writeFile(join(workdir, "text", `${i}.txt`), "x".repeat(1024 * 1024 - 8) + String(i).padStart(8, "0"));
    }
    await ledger.commitAgentWindow("turn1");

    await expect(ledger.exportWindows()).rejects.toThrow(/transfers \d+ text blob bytes; limit is 67108864/);
  }, 60_000);

  // 预算只数真正要传输的文本字节:二进制与单文件超限文本只出字节数,不占预算
  // (旧口径「二进制按尺寸计」会把编译产物型窗口误判成越界)。
  it("二进制与单文件超限文本内容显式省略、不占窗口预算;存在性与 status 照常记录", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);
    await mkdir(join(workdir, "obj"), { recursive: true });
    await mkdir(join(workdir, "big"), { recursive: true });
    // 33 MiB 二进制 + 34 MiB 超限文本 = 67 MiB「尺寸证据」,按旧口径已越界。
    for (let i = 0; i < 33; i++) {
      await writeFile(join(workdir, "obj", `${i}.o`), Buffer.alloc(1024 * 1024, i % 251));
    }
    for (let i = 0; i < 17; i++) {
      await writeFile(join(workdir, "big", `${i}.txt`), "y".repeat(2 * 1024 * 1024));
    }
    await writeFile(join(workdir, "small.txt"), "inline me\n");
    await ledger.commitAgentWindow("turn1");
    // 第二个窗口再改一次超限文本:before/after 两侧字节数都要记下来。
    await writeFile(join(workdir, "big", "0.txt"), "z".repeat(3 * 1024 * 1024));
    await ledger.commitAgentWindow("turn2");

    const windows = await ledger.exportWindows();
    expect(windows[0]!.changes["obj/0.o"]).toEqual({ status: "added", elided: { reason: "binary", afterBytes: 1024 * 1024 } });
    expect(windows[0]!.changes["big/0.txt"]).toEqual({
      status: "added",
      elided: { reason: "oversized-text", afterBytes: 2 * 1024 * 1024 },
    });
    // 同窗口里没超阈值的文本照常内联,省略是逐文件的、不牵连整窗口。
    expect(windows[0]!.changes["small.txt"]).toEqual({ status: "added", after: "inline me\n" });
    expect(windows[1]!.changes["big/0.txt"]).toEqual({
      status: "modified",
      elided: { reason: "oversized-text", beforeBytes: 2 * 1024 * 1024, afterBytes: 3 * 1024 * 1024 },
    });

    const diff = deriveDiffData(windows);
    // 存在性与 net 照常成立(fileChanged 断得到),只有内容读不到。
    // 派生摘要带省略原因(单源是 WindowChange.elided):二进制与超限文本各自如实标注。
    expect(diff.files["obj/0.o"]).toEqual({ net: "added", windows: ["turn1"], elided: "binary" });
    expect(diff.files["big/0.txt"]).toEqual({ net: "added", windows: ["turn1", "turn2"], elided: "oversized-text" });
    expect(diff.files["small.txt"]).toEqual({ net: "added", windows: ["turn1"] });
    expect(elidedContentAt(diff, "big/0.txt")).toEqual({
      reason: "oversized-text",
      beforeBytes: 2 * 1024 * 1024,
      afterBytes: 3 * 1024 * 1024,
    });
    expect(elidedContentPaths(diff)).toContain("obj/0.o");
    expect(diff.get("small.txt")).toBe("inline me\n");
  }, 120_000);

  it("窗口内没有变化时仍落一条空窗口(changes 为空对象)", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);
    await ledger.commitAgentWindow("turn1");
    const windows = await ledger.exportWindows();
    expect(windows).toEqual([{ window: "turn1", changes: {} }]);
  });
});
