// e2e 回归:niceeval 作为 link 式依赖(pnpm link / node_modules symlink,workspace: 协议底层
// 也是这种形态)被外部项目消费时,package-owned 报告组件(唯一含 .tsx 的运行时子树,
// src/report/**)不能因为消费方进程 cwd 的 tsconfig JSX 配置崩成
// `ReferenceError: React is not defined`。根因与修法见
// memory/report-build-rootdir-and-module-identity.md、memory/global-react-jsx-shim-rejected.md:
// tsx 的 JSX 编译按调用进程 cwd 找 tsconfig,niceeval 被 link 消费时消费方的 tsconfig(或它的
// 缺失)会接管 src/report/**.tsx 的编译,可能退化成 classic transform、产物引用未定义的全局
// React —— 修法是 src/report/** 在 niceeval 自己的构建时预编译成 dist/report/**(纯 JS + d.ts,
// 见 tsconfig.report-build.json),运行期不再需要 tsx 编译任何 .tsx。
//
// 覆盖组合(每种都通过真实子进程跨越 cwd 边界,不是同进程 import ——
// bug 本体就是「消费方进程 cwd」,同进程测试测不出这类问题):
//   (a) 消费方 cwd 没有 tsconfig.json
//   (b) 消费方 tsconfig.json 显式声明 classic JSX transform(pre-fix 下这是真实崩溃复现,
//       见下方"sanity"用例的姊妹验证 —— 本文件写作时曾手工确认过 raw src 路径在这个
//       tsconfig 下会抛 `ReferenceError: React is not defined`)
//   (c) 消费方 tsconfig.json 显式声明 react-jsx transform
// 三种场景都经同一条链路接入 niceeval —— node_modules/niceeval 是指向本仓库根的 symlink
// (pnpm link 风格),这正是 bug 复现的必要条件之一;不用 symlink 单纯改 cwd 不足以还原
// "linked dependency" 场景(见任务要求里的第 4 种情形,在这里通过全部用例共用的 link 机制满足,
// 不是第四个独立分支——三种 tsconfig 场景本就都跑在 link 消费之上)。
//
// 每个场景:临时目录 + 落一份新布局(schemaVersion 5,docs/feature/results/architecture.md)结果 +
// symlink node_modules/niceeval → 仓库根,真实子进程跑
// `node <consumer>/node_modules/niceeval/bin/niceeval.js show`,断言退出码 0、stdout 渲染出
// 默认报告(CostPassRateComparison 摆的 ExperimentList),stderr 没有 ReferenceError /
// React 相关字样。

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const dirs: string[] = [];
async function makeConsumerDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-consumer-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** 落一份新布局(schemaVersion 5)结果:一个 experiment、一个 snapshot、一次 passed attempt——
 * show 裸跑只读 .niceeval/**,不依赖 niceeval.config.ts(见 src/cli.ts 的注释)。 */
async function seedResults(consumerDir: string): Promise<void> {
  const snapDir = join(consumerDir, ".niceeval", "demo_bub", "2026-07-12T10-00-00-000Z");
  await mkdir(snapDir, { recursive: true });
  await writeFile(
    join(snapDir, "snapshot.json"),
    JSON.stringify(
      {
        format: "niceeval.results",
        schemaVersion: 5,
        producer: { name: "niceeval", version: "0.4.6" },
        experimentId: "demo/bub",
        agent: "bub",
        startedAt: "2026-07-12T10:00:00.000Z",
        completedAt: "2026-07-12T10:00:05.000Z",
      },
      null,
      2,
    ),
    "utf-8",
  );
  const attemptDir = join(snapDir, "weather", "a0");
  await mkdir(attemptDir, { recursive: true });
  await writeFile(
    join(attemptDir, "result.json"),
    JSON.stringify({ id: "weather", verdict: "passed", attempt: 0, durationMs: 500, assertions: [] }, null, 2),
    "utf-8",
  );
}

/** node_modules/niceeval → 仓库根的 symlink(pnpm link 风格);返回 niceeval bin 的绝对路径。 */
async function linkNiceeval(consumerDir: string): Promise<string> {
  await mkdir(join(consumerDir, "node_modules"), { recursive: true });
  await symlink(repoRoot, join(consumerDir, "node_modules", "niceeval"), "dir");
  return join(consumerDir, "node_modules", "niceeval", "bin", "niceeval.js");
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runConsumerShow(consumerDir: string, niceevalBin: string): Promise<CliResult> {
  const child = spawn(process.execPath, [niceevalBin, "show"], { cwd: consumerDir, stdio: "pipe" });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += String(d)));
  child.stderr.on("data", (d) => (stderr += String(d)));
  const code = await new Promise<number>((resolveExit) => child.on("exit", (c) => resolveExit(c ?? 1)));
  return { code, stdout, stderr };
}

function assertCleanReportRender(result: CliResult): void {
  expect(result.stderr).not.toMatch(/ReferenceError/);
  expect(result.stderr).not.toMatch(/React is not defined/);
  expect(result.stdout).not.toMatch(/ReferenceError/);
  expect(result.code).toBe(0);
  // 默认报告是 CostPassRateComparison:ExperimentList 渲染出这个 agent 行与通过率——
  // 真实 JSX 组件树、真实 react-dom 无关(text 面走 renderNodeToText,不含 react-dom),
  // 但同一批 .tsx 源码在 show 的加载路径上被解析求值,能吐出正确内容就证明没有半路崩溃。
  expect(result.stdout).toContain("Cost × Pass rate");
  expect(result.stdout).toContain("bub");
  expect(result.stdout).toContain("100%");
  expect(result.stdout).toContain("1 passed");
}

describe("niceeval 作为 link 式依赖:package-owned 报告组件跨消费方 cwd 渲染", () => {
  it("(a) 消费方 cwd 没有 tsconfig.json", async () => {
    const consumerDir = await makeConsumerDir();
    await seedResults(consumerDir);
    const niceevalBin = await linkNiceeval(consumerDir);
    assertCleanReportRender(await runConsumerShow(consumerDir, niceevalBin));
  });

  it("(b) 消费方 tsconfig.json 显式声明 classic JSX transform", async () => {
    const consumerDir = await makeConsumerDir();
    await seedResults(consumerDir);
    await writeFile(
      join(consumerDir, "tsconfig.json"),
      JSON.stringify(
        { compilerOptions: { jsx: "react", target: "ES2020", module: "ESNext", moduleResolution: "bundler" } },
        null,
        2,
      ),
      "utf-8",
    );
    const niceevalBin = await linkNiceeval(consumerDir);
    assertCleanReportRender(await runConsumerShow(consumerDir, niceevalBin));
  });

  it("(c) 消费方 tsconfig.json 显式声明 react-jsx transform", async () => {
    const consumerDir = await makeConsumerDir();
    await seedResults(consumerDir);
    await writeFile(
      join(consumerDir, "tsconfig.json"),
      JSON.stringify(
        { compilerOptions: { jsx: "react-jsx", target: "ES2020", module: "ESNext", moduleResolution: "bundler" } },
        null,
        2,
      ),
      "utf-8",
    );
    const niceevalBin = await linkNiceeval(consumerDir);
    assertCleanReportRender(await runConsumerShow(consumerDir, niceevalBin));
  });
});
