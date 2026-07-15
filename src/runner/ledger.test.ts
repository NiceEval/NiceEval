// 变更分类账的集成测试:用宿主 shell 扮演沙箱(真实 git),验证
// - .git 不在 workdir 内(agent 看不到分类账;eval 自己 git init 不冲突)
// - eval 归因(send 前写入)不进 agent diff;send 窗口内写入逐窗口归因
// - 排除清单(默认 + ignore)与 include 打洞
// - 「创建又删除」「改回原样」净效果为 none,但触及窗口仍留痕(fileChanged 语义)

import { afterEach, describe, expect, it } from "vitest";
import { exec } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createChangeLedger } from "./ledger.ts";
import { deriveDiffData } from "../scoring/diff.ts";
import type { CommandResult, Sandbox } from "../types.ts";

const execAsync = promisify(exec);

/** 宿主目录扮演沙箱 workdir;runShell 用真实 shell 跑,downloadFile 读宿主文件(ledger 只用这两个 + env)。 */
function hostSandbox(
  workdir: string,
  ledgerDir: string,
  counters?: { shells?: string[]; downloads?: string[] },
): Sandbox {
  // 把 ledger 的固定 /tmp 路径前缀重定向到本测试的私有目录,测试之间互不污染
  // (导出目录 /tmp/.niceeval-ledger-export 共享同一前缀,一条规则同时覆盖)。
  const patchPath = (s: string) => s.replaceAll("/tmp/.niceeval-ledger", ledgerDir);
  const runShell = async (script: string, opts?: { env?: Record<string, string> }): Promise<CommandResult> => {
    counters?.shells?.push(script);
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
  const downloadFile = async (path: string): Promise<Buffer> => {
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
    readFile: async () => "",
    fileExists: async () => false,
    readSourceFiles: async () => {
      throw new Error("not used");
    },
    writeFiles: async () => {},
    uploadFiles: async () => {},
    uploadDirectory: async () => {},
    downloadFile,
    uploadFile: async () => {},
    stop: async () => {},
  } as unknown as Sandbox;
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
  it("锚点后 workdir 素净(无 .git);逐窗口归因,eval 侧写入不进 agent diff", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    await writeFile(join(workdir, "start.txt"), "fixture\n");
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);

    // workdir 保持素净:分类账的 git 目录在 workdir 外。
    expect(await readdir(workdir)).not.toContain(".git");

    // eval 侧写入(send 前):进 eval 归因,不进 agent diff。
    await writeFile(join(workdir, "fixture.json"), "{}\n");
    await ledger.commitEvalWindow("s1/t1");

    // 窗口 1:agent 改 start.txt、新建 out.txt。
    await writeFile(join(workdir, "start.txt"), "changed by agent\n");
    await writeFile(join(workdir, "out.txt"), "hello\n");
    await writeFile(join(workdir, "with space.txt"), "space-safe\n");
    await writeFile(join(workdir, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await ledger.commitAgentWindow("s1/t1");

    // 窗口间 eval 写入(隐藏校验文件):不得计入任何 agent 窗口。
    await writeFile(join(workdir, "hidden-check.txt"), "verify\n");
    await ledger.commitEvalWindow("s1/t2");

    // 窗口 2:agent 删除 out.txt(创建又删除 → 净 none,但两个窗口都留痕)。
    await rm(join(workdir, "out.txt"));
    await ledger.commitAgentWindow("s1/t2");

    const windows = await ledger.exportWindows();
    expect(windows.map((w) => w.window)).toEqual(["s1/t1", "s1/t2"]);
    expect(windows[0]!.changes["start.txt"]).toMatchObject({ status: "modified", after: "changed by agent\n" });
    expect(windows[0]!.changes["out.txt"]).toMatchObject({ status: "added", after: "hello\n" });
    expect(windows[0]!.changes["with space.txt"]).toMatchObject({ status: "added", after: "space-safe\n" });
    expect(windows[0]!.changes["binary.bin"]).toEqual({ status: "added", binary: { afterBytes: 4 } });
    expect(windows[0]!.changes["fixture.json"]).toBeUndefined();
    expect(windows[1]!.changes["out.txt"]).toMatchObject({ status: "deleted", before: "hello\n" });
    expect(windows[1]!.changes["hidden-check.txt"]).toBeUndefined();

    const diff = deriveDiffData(windows);
    // fileChanged 语义:任一窗口触及即算发生过;net=none(创建又删除)仍留痕。
    expect(diff.files["out.txt"]).toEqual({ net: "none", windows: ["s1/t1", "s1/t2"] });
    expect(diff.files["start.txt"]).toEqual({ net: "modified", windows: ["s1/t1"] });
    expect(diff.get("start.txt")).toBe("changed by agent\n");
    expect(diff.get("out.txt")).toBeUndefined();
  });

  it("eval 可以在 workdir 自己 git init,不与分类账冲突;agent 的 .git 不进归因", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);

    // eval 在 workdir 里建真实 git repo(agent 视角的项目仓库)。
    await execAsync('git init -q && git config user.email t@t && git config user.name t', { cwd: workdir });
    await ledger.commitEvalWindow("s1/t1");

    await writeFile(join(workdir, "app.ts"), "export {};\n");
    await ledger.commitAgentWindow("s1/t1");

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
    await mkdir(join(workdir, "secret"), { recursive: true });
    await writeFile(join(workdir, "secret", "token.txt"), "excluded via ignore\n");
    // Python 工具链目录不依赖项目 .gitignore:任意 *venv*/ 名字都由 runner 私有清单排除。
    for (const dir of ["venv", ".venv", ".testing-venv", "tools/pypi-venv"]) {
      await mkdir(join(workdir, dir), { recursive: true });
      await writeFile(join(workdir, dir, "dependency.py"), "excluded virtualenv dependency\n");
    }
    await ledger.commitAgentWindow("s1/t1");

    const windows = await ledger.exportWindows();
    const paths = Object.keys(windows[0]!.changes).sort();
    expect(paths).toContain("output.txt");
    expect(paths).toContain("node_modules/keep.js");
    expect(paths).not.toContain("node_modules/dep.js");
    expect(paths).not.toContain("secret/token.txt");
    expect(paths.some((path) => path.includes("venv"))).toBe(false);
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
    await ledger.commitAgentWindow("s1/t1");
    await writeFile(join(workdir, "second.txt"), "second window\n");
    await ledger.commitAgentWindow("s1/t2");

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
    await ledger.commitAgentWindow("s1/t1");

    await expect(ledger.exportWindows()).rejects.toThrow("contains 10001 paths; limit is 10000");
  }, 30_000);

  it("单窗口文本证据超过字节上限时明确失败,尺寸核算先于内容传输", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);
    await writeFile(join(workdir, "huge.txt"), "x".repeat(65 * 1024 * 1024));
    await ledger.commitAgentWindow("s1/t1");

    await expect(ledger.exportWindows()).rejects.toThrow("blob bytes");
  }, 30_000);

  it("窗口内没有变化时仍落一条空窗口(changes 为空对象)", async () => {
    const { workdir, ledgerDir } = await makeDirs();
    const sandbox = hostSandbox(workdir, ledgerDir);
    const ledger = await createChangeLedger(sandbox);
    await ledger.commitAgentWindow("s1/t1");
    const windows = await ledger.exportWindows();
    expect(windows).toEqual([{ window: "s1/t1", changes: {} }]);
  });
});
