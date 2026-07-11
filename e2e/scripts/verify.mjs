#!/usr/bin/env node
// e2e 的"真正的测试"(docs/e2e-ci.md 第 5 节):把 niceeval CLI 当黑盒子进程跑,
// 对照期望表校验退出码 + summary.json。eval 只是 fixture,判红判绿的责任在这里。
//
// 前置:e2e/apps 下对应的被测应用已经在跑(CI workflow 或本地开发者自己起,eval 不代管进程)。
// 沙箱矩阵(claude-code / codex 两行,见 docs/e2e-ci.md §4.2)不需要被测应用,前置换成
// 本机 docker daemon 可用。
// 用法:node e2e/scripts/verify.mjs [项目名过滤,如 ai-sdk-v7 或 claude-code]
import { spawn } from "node:child_process";
import { readdir, readFile, stat, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect } from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const e2eRoot = join(here, "..");
const repoRoot = join(e2eRoot, "..");
const BIN = join(repoRoot, "bin", "niceeval.js");

// 期望表:每行 = 一次 CLI 调用。evals = 按 profile 算出的期望 eval 数(防"少排用例还全绿",
// 见 docs/e2e-ci.md 3.1"防静默失配");ci 期望全绿 exit 0,verdicts 期望 exit 1 且一红一炸。
const PLAN = [
  { project: "ai-sdk-v7",  exp: "ci",       port: 34001, expectExit: 0, evals: 8, allPass: true },
  { project: "ai-sdk-v7",  exp: "verdicts", port: 34001, expectExit: 1, evals: 2, failedAtLeast: 1, erroredAtLeast: 1 },
  { project: "pi-sdk",     exp: "ci",       port: 33001, expectExit: 0, evals: 7, allPass: true },
  { project: "pi-sdk",     exp: "verdicts", port: 33001, expectExit: 1, evals: 2, failedAtLeast: 1, erroredAtLeast: 1 },
  { project: "claude-sdk", exp: "ci",       port: 32001, expectExit: 0, evals: 7, allPass: true },
  { project: "claude-sdk", exp: "verdicts", port: 32001, expectExit: 1, evals: 2, failedAtLeast: 1, erroredAtLeast: 1 },
  { project: "langgraph",  exp: "ci",       port: 35000, expectExit: 0, evals: 7, allPass: true },
  { project: "langgraph",  exp: "verdicts", port: 35000, expectExit: 1, evals: 2, failedAtLeast: 1, erroredAtLeast: 1 },
  { project: "codex-sdk",  exp: "ci",       port: 31001, expectExit: 0, evals: 5, allPass: true },
  { project: "codex-sdk",  exp: "verdicts", port: 31001, expectExit: 1, evals: 2, failedAtLeast: 1, erroredAtLeast: 1 },

  // L1 沙箱矩阵(docs/e2e-ci.md §4.2):claude-code / codex 内置 agent × dockerSandbox()。
  // 没有被测应用进程要等,前置条件换成"docker daemon 可用";ci 组跑基线 agent(不装
  // skills/MCP),features 组跑挂了 skills+MCP 的 agent(只含 "feature-" 前缀的正例)。
  { project: "claude-code", exp: "ci",       docker: true, expectExit: 0, evals: 8, allPass: true },
  { project: "claude-code", exp: "features", docker: true, expectExit: 0, evals: 2, allPass: true },
  { project: "claude-code", exp: "verdicts", docker: true, expectExit: 1, evals: 2, failedAtLeast: 1, erroredAtLeast: 1 },
  { project: "codex",       exp: "ci",       docker: true, expectExit: 0, evals: 8, allPass: true },
  { project: "codex",       exp: "features", docker: true, expectExit: 0, evals: 2, allPass: true },
  { project: "codex",       exp: "verdicts", docker: true, expectExit: 1, evals: 2, failedAtLeast: 1, erroredAtLeast: 1 },
];

function portUp(port) {
  return new Promise((resolve) => {
    const sock = connect({ port, host: "127.0.0.1" }, () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
    sock.setTimeout(1500, () => { sock.destroy(); resolve(false); });
  });
}

/** docker daemon 可达性检查(沙箱矩阵的前置条件,取代被测应用的端口探活)。 */
function dockerUp() {
  return new Promise((resolve) => {
    const child = spawn("docker", ["info"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function runCli(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, stdio: ["ignore", "inherit", "inherit"] });
    child.on("close", (code) => resolve(code ?? 2));
  });
}

async function latestSummary(projectDir) {
  const outRoot = join(projectDir, ".niceeval");
  const found = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name === "summary.json") found.push(p);
    }
  }
  await walk(outRoot);
  if (found.length === 0) return null;
  const stats = await Promise.all(found.map(async (p) => ({ p, mtime: (await stat(p)).mtimeMs })));
  stats.sort((a, b) => b.mtime - a.mtime);
  return { path: stats[0].p, summary: JSON.parse(await readFile(stats[0].p, "utf8")) };
}

// 过滤参数三种取值:项目名(如 ai-sdk-v7)、组名 sdk(HTTP 被测应用的 5 个项目,
// CI 的 PR 门禁 job 用)、组名 sandbox(docker 沙箱矩阵,CI 的 nightly job 用)。
const filter = process.argv[2];
const failures = [];
let ran = 0;

const matches = (row) => {
  if (!filter) return true;
  if (filter === "sdk") return !row.docker;
  if (filter === "sandbox") return Boolean(row.docker);
  return row.project === filter;
};

for (const row of PLAN) {
  if (!matches(row)) continue;
  ran++;
  const tag = `${row.project}/${row.exp}`;
  const projectDir = join(e2eRoot, "projects", row.project);

  if (row.docker) {
    if (!(await dockerUp())) {
      failures.push(`${tag}: docker daemon 连不上(docker info 失败)。沙箱矩阵需要本机 docker 在跑。`);
      continue;
    }
  } else if (!(await portUp(row.port))) {
    failures.push(`${tag}: app 未就绪(127.0.0.1:${row.port} 连不上)。先起 e2e/apps/${row.project} 再跑。`);
    continue;
  }

  console.log(`\n=== ${tag} (expect exit ${row.expectExit}) ===`);
  const startedAt = Date.now();
  const exit = await runCli(projectDir, ["exp", row.exp, "--force"]);
  if (exit !== row.expectExit) {
    failures.push(`${tag}: exit ${exit},期望 ${row.expectExit}`);
  }

  const latest = await latestSummary(projectDir);
  if (!latest) { failures.push(`${tag}: 找不到 summary.json`); continue; }
  const { path: summaryPath, summary } = latest;
  if ((await stat(summaryPath)).mtimeMs < startedAt) {
    failures.push(`${tag}: summary.json 不是本次运行产出的(--force 失效或运行没落盘?)`);
    continue;
  }

  // 工件格式契约(只查形状,不钉版本值)
  for (const field of ["format", "schemaVersion", "producer", "passed", "failed", "errored", "results"]) {
    if (summary[field] === undefined) failures.push(`${tag}: summary.json 缺字段 ${field}`);
  }

  // 计票口径与 CLI 退出码 / 报表一致:按 eval 折叠(任一 attempt 通过 → 该 eval 通过,
  // 对齐 runs+earlyExit「先过一次即停」的吸抖动语义),不按 attempt——summary 顶层的
  // passed/failed 是 attempt 级原始计数,直接拿来判 allPass 会把被重试吸收的抖动误判成红。
  const byEval = new Map();
  for (const r of summary.results ?? []) {
    const key = r.id;
    byEval.set(key, [...(byEval.get(key) ?? []), r.verdict]);
  }
  const evalCounts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const verdicts of byEval.values()) {
    const folded = verdicts.includes("passed") ? "passed"
      : verdicts.includes("failed") ? "failed"
      : verdicts.includes("errored") ? "errored" : "skipped";
    evalCounts[folded] += 1;
  }

  // 按 profile 对账 eval 数:results 按 attempt 计,数去重后的 eval id
  if (byEval.size !== row.evals) {
    failures.push(`${tag}: 发现 ${byEval.size} 条 eval(${[...byEval.keys()].join(", ")}),期望 ${row.evals} 条`);
  }

  if (row.allPass && (evalCounts.failed > 0 || evalCounts.errored > 0)) {
    failures.push(`${tag}: failed=${evalCounts.failed} errored=${evalCounts.errored}(eval 级),期望全绿`);
  }
  if (row.failedAtLeast && evalCounts.failed < row.failedAtLeast) {
    failures.push(`${tag}: failed=${evalCounts.failed}(eval 级),期望 ≥ ${row.failedAtLeast}`);
  }
  if (row.erroredAtLeast && evalCounts.errored < row.erroredAtLeast) {
    failures.push(`${tag}: errored=${evalCounts.errored}(eval 级),期望 ≥ ${row.erroredAtLeast}`);
  }

  // 抽查一个 attempt 工件目录真实存在
  const withDir = (summary.results ?? []).find((r) => r.artifactsDir);
  if (withDir) {
    try { await access(join(dirname(summaryPath), withDir.artifactsDir)); }
    catch {
      try { await access(withDir.artifactsDir); }
      catch { failures.push(`${tag}: results[].artifactsDir 指向不存在的目录: ${withDir.artifactsDir}`); }
    }
  }
}

console.log(`\n${"=".repeat(60)}`);
if (ran === 0) {
  console.error(`没有匹配 "${filter}" 的计划行`);
  process.exit(2);
}
if (failures.length) {
  console.error(`verify FAILED(${failures.length} 处):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`verify OK:${ran} 次 CLI 调用全部符合期望。`);
