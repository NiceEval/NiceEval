#!/usr/bin/env -S npx tsx
// scripts/e2e.ts — cli 唯一执行入口(docs/engineering/testing/e2e/README.md §3.1)。
// 装依赖 → 清理上次运行的临时结果 → 跑验收(scripts/verify.ts,内含全部
// niceeval exp / show 调用)。本仓库使用签入确定性 Agent,不需要 secret 或被测服务。

import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { runVerify } from "./verify.ts";

function runInherited(cmd: string, args: string[]): number {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  return res.status ?? 1;
}

async function main(): Promise<void> {
  // 1. 安装依赖——候选包注入由根编排器完成(见 e2e/scripts/injection.ts);这里只保证
  //    独立跑(`cd e2e/cli && pnpm e2e`)时 node_modules 存在。
  if (!existsSync("node_modules")) {
    console.log("[cli] installing dependencies ...");
    // --ignore-workspace: 独立跑在本 checkout 原地(未被编排器复制到隔离目录)时,e2e/ 目录
    // 下还留着旧架构(apps/projects/shared)的 pnpm-workspace.yaml,会把这里的 install 顶到
    // 那个共享 workspace 根、复用它的 lockfile/node_modules,而不是给本仓库生成自己的
    // lockfile——加这个 flag 让本仓库在任何位置都按独立项目装依赖(编排器把仓库复制到 OS
    // tmp 目录后本就在该 workspace 之外,这个 flag 此时是无操作)。
    const code = runInherited("pnpm", ["install", "--no-frozen-lockfile", "--ignore-workspace"]);
    if (code !== 0) {
      console.error(`[cli] pnpm install failed (exit ${code})`);
      process.exitCode = 1;
      return;
    }
  }

  // 2. 清理上一次运行的临时结果——缓存三步的基线计数必须从这次 pnpm e2e 调用开始重新数,
  //    不能被上一次运行遗留的 attempt 历史污染。
  rmSync(".niceeval", { recursive: true, force: true });

  // 3. 无被测服务需要起停。

  // 4. 验收(选择、退出码折叠、缓存三步、CLI 读回),把预期非零退出转换成通过/失败判定。
  try {
    await runVerify();
    console.log("\n[cli] all assertions passed.");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[cli] verification failed:");
    console.error(err);
    process.exitCode = 1;
  }
}

main();
