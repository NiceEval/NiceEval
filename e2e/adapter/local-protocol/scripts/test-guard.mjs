#!/usr/bin/env node
// 场景 Repo 的直接执行不是正式入口（docs/engineering/testing/e2e/scenario-repos.md）：
// 只有根 runner 构造候选与 Testkit 双 tgz、在隔离副本中注入后才允许跑测试。
// 因此在场景内直接 `pnpm test` 必须非零退出并引导用户去仓库根。
const REPO_ID = "adapter/local-protocol";

console.error(
  [
    `直接进入场景 ${REPO_ID} 运行 pnpm test 不是正式入口。`,
    "请在 niceeval 仓库根目录运行：",
    "",
    `    pnpm e2e --repo ${REPO_ID}`,
    "",
    "根 runner 会构建候选与 Testkit 双 tgz，并在隔离副本中注入后执行原生 Vitest 命令。",
  ].join("\n"),
);
process.exit(1);
