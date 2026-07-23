#!/usr/bin/env -S npx tsx
// report 仓库的唯一执行入口(docs/engineering/testing/e2e/README.md §3.1):
// fail-fast 检查 → 清空上一次运行的证据 → 生产本次运行共用的证据(scripts/evidence.ts)→
// 依次跑每个验收域 → 按结果分类退出码。没有服务需要起停——本仓库的 Agent 是一次远程 HTTP
// 调用,不是这个仓库自己拥有的 coding-agent 进程。
//
// 新增验收域的约定(docs/engineering/testing/e2e/report.md §4/§5,例如 B2 读面 / B3 渲染面
// 结构 / B4 渲染面视觉 / B5 自定义报告):新建自己的 scripts/verify-<domain>.ts,导出一个接收
// `Evidence` 对象、遇到第一个违反契约的地方就抛错的 async 函数(参照 scripts/verify-format.ts
// 的写法)。然后在下面标记的位置用**恰好一行 import + 一行调用**接入——绝不重新调用
// `produceEvidence()`,绝不重新跑一次 Experiment。加这两行时用 Edit 工具(不要整份重写):
// 如果另一个 agent 正好也在改这个文件,Edit 会因为原文本对不上而报错、不会互相覆盖,重新
// Read 一遍文件再 Edit 一次就行。
//
// 顺序规则:`verifyReadback` 会在自己函数末尾真实追加 2 次 `niceeval exp main` 调用,改变
// main 实验"当前"是哪份快照。任何**现场调用** `niceeval show`/`view` 去核对
// `evidence.main`/`deliberateFail`/`deliberateError` 原始 locator 的验收函数(而不是只读
// `evidence.siteExportDir` 里已经导出好的静态文件,那些不受影响),必须排在 `verifyReadback`
// 之前——详见 memory/verify-readback-mutation-orders-later-e2e-report-domains.md。只读
// `siteExportDir` 的模块可以放在任意位置。

import "dotenv/config";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { InfraError, produceEvidence } from "./evidence.ts";
import { verifyFormat } from "./verify-format.ts";
import { verifyReadback } from "./verify-readback.ts";
import { verifyRenderStructure } from "./verify-render-structure.ts";
import { verifyRenderVisual } from "./verify-render-visual.ts";
import { verifyCustomReports } from "./verify-custom-reports.ts";
// ── new verify-<domain>.ts imports go here (one line each) ──

const EX_TEMPFAIL = 75;
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function fail(message: string): never {
  console.error(`[e2e] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // 1. fail-fast:必需的 secrets、候选 niceeval 是否解析得到。
  const requiredSecrets = ["OPENAI_API_KEY", "OPENAI_BASE_URL"];
  const missing = requiredSecrets.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail(`missing required secret(s): ${missing.join(", ")} — set them in .env (see .env.example)`);
  }

  try {
    const pkgPath = join(REPO_ROOT, "node_modules", "niceeval", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    console.log(`[e2e] resolved niceeval ${pkg.version ?? "(unknown version)"} from ${pkgPath}`);
  } catch (err) {
    fail(`could not resolve niceeval from node_modules — did \`pnpm install\` run? (${(err as Error).message})`);
  }

  // 2. 清空这个仓库上一次运行留下的证据——绝不能成为这次运行的输入。
  rmSync(join(REPO_ROOT, ".niceeval"), { recursive: true, force: true });
  rmSync(join(REPO_ROOT, "site-export"), { recursive: true, force: true });
  for (const relPath of ["main.ndjson", "main.xml", "fail.xml", "error.xml"]) {
    rmSync(join(REPO_ROOT, relPath), { force: true });
  }

  // 3. 没有服务需要起停——Agent 是一次远程 HTTP 调用(docs/engineering/testing/e2e/README.md §2.2)。

  // 4-6. 生产本次运行共用的证据一次,依次跑每个验收域,再按结果分类退出码。
  try {
    const evidence = await produceEvidence();
    await verifyFormat(evidence);
    // verifyRenderStructure 必须排在 verifyReadback 之前:verifyReadback 的
    // verifyHistoryAndPages 会在自己文档明确写明的最后一步真实追加 2 次 `niceeval exp main`
    // 调用,改变 main 实验"当前"是哪份快照——如果这个模块排在那次变更之后,
    // evidence.main 原始的 locator 就不会再出现在 --page traces / show 的
    // ExperimentList(当前 Scope 视图)里。
    await verifyRenderStructure(evidence);
    // verifyCustomReports 现场调用 `niceeval show`/`view --report <自定义文件>` 去核对
    // evidence.main/deliberateFail/deliberateError 的原始 locator(它自己独立的 `--out` 导出,
    // 与 evidence.siteExportDir 无关),同样必须排在 verifyReadback 之前(理由同上)。
    await verifyCustomReports(evidence);
    await verifyReadback(evidence);
    // verifyRenderVisual 只读 evidence.siteExportDir 已导出好的静态文件(attempt/<locator>.html
    // 走 file://,index.html 靠本地起的静态文件 HTTP server)——不现场调用 `niceeval show`/`view`
    // 去查询"当前" Scope,不受 verifyReadback 的变更影响,可以排在它之后(见文件头的顺序规则)。
    await verifyRenderVisual(evidence);
    // ── 新的 verify-<domain>.ts 调用加在这里(每行一个)——是否要排在 verifyReadback 之前,
    // 按文件头的顺序规则判断 ──
    console.log("[e2e] report: all assertions passed");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(err instanceof InfraError ? EX_TEMPFAIL : 1);
  }
}

main();
