#!/usr/bin/env -S npx tsx
// scripts/e2e.ts — cli-contract 唯一执行入口(docs/engineering/e2e-ci/README.md §3.1)。
// 检查 secrets → 装依赖 → 清理上次运行的临时结果 → 跑验收(scripts/verify.ts,内含全部
// niceeval exp / show 调用)→ 按「能确证的外部故障退 75,其余一律回归」折叠退出码。
// 本仓库没有需要起停的被测服务(remote agent 直连真实网关)。

import "dotenv/config";

import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { runVerify } from "./verify.ts";

const EX_TEMPFAIL = 75;
const REQUIRED_SECRETS = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;

function runInherited(cmd: string, args: string[]): number {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  return res.status ?? 1;
}

async function main(): Promise<void> {
  // 1. secrets fail-fast——本仓库实际用到的只有这两个;judge 两个未用到(见仓库 README),
  //    不在此校验,只在 e2e.json.secrets 里保留声明供编排器一致性核对。
  const missing = REQUIRED_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`[cli-contract] missing required secret(s): ${missing.join(", ")} — see .env.example`);
    process.exitCode = 1;
    return;
  }

  // 2. 安装依赖——候选包注入由根编排器完成(见 e2e/scripts/injection.ts);这里只保证
  //    独立跑(`cd e2e/repos/cli-contract && pnpm e2e`)时 node_modules 存在。
  if (!existsSync("node_modules")) {
    console.log("[cli-contract] installing dependencies ...");
    // --ignore-workspace: 独立跑在本 checkout 原地(未被编排器复制到隔离目录)时,e2e/ 目录
    // 下还留着旧架构(apps/projects/shared)的 pnpm-workspace.yaml,会把这里的 install 顶到
    // 那个共享 workspace 根、复用它的 lockfile/node_modules,而不是给本仓库生成自己的
    // lockfile——加这个 flag 让本仓库在任何位置都按独立项目装依赖(编排器把仓库复制到 OS
    // tmp 目录后本就在该 workspace 之外,这个 flag 此时是无操作)。
    const code = runInherited("pnpm", ["install", "--no-frozen-lockfile", "--ignore-workspace"]);
    if (code !== 0) {
      console.error(`[cli-contract] pnpm install failed (exit ${code})`);
      process.exitCode = EX_TEMPFAIL;
      return;
    }
  }

  // 3. 清理上一次运行的临时结果——缓存三步的基线计数必须从这次 pnpm e2e 调用开始重新数,
  //    不能被上一次运行遗留的 attempt 历史污染。
  rmSync(".niceeval", { recursive: true, force: true });

  // 4. 无被测服务需要起停。

  // 5-6. 验收(选择、退出码折叠、缓存三步、CLI 读回),把预期非零退出转换成通过/失败判定。
  try {
    await runVerify();
    console.log("\n[cli-contract] all assertions passed.");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[cli-contract] verification failed:");
    console.error(err);

    let ciLog = "";
    try {
      ciLog = readFileSync("logs/exp-ci.log", "utf8");
    } catch {
      // 日志还没写出(极早期失败),留空即可,走回归分类。
    }

    // 能确证的外部故障:provider 429/5xx/网络错误,或本网关特有的结构化「key 被禁用」信号
    // (API_KEY_DISABLED——网关明确返回的结构化状态,不是 niceeval 或本仓库自己的断言失败,
    // 见 memory 台账)。判不准就按回归退出——宁可误报回归,不可把回归漏报成环境问题。
    const infra = /errored.*(429|5\d\d|ECONNREFUSED|ETIMEDOUT|API_KEY_DISABLED)/.test(ciLog);
    process.exitCode = infra ? EX_TEMPFAIL : 1;
  }
}

main();
