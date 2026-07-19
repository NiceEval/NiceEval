---
name: vitest-collects-sandbox-plugin-content-under-e2e-repos
description: 根 vitest 曾把 e2e/repos/codex-sdk/.codex-home/ 下真机拉取的第三方插件内容当成正式测试跑，同类问题见 [[vitest-collects-agent-worktree-copies]]
metadata:
  type: infra-bug
---

**现象**：`pnpm test` 报出 4 个失败文件，全部路径形如
`e2e/repos/codex-sdk/.codex-home/.tmp/plugins/plugins/<third-party-plugin>/**/*.test.ts`——
`codex-sdk` E2E 仓库真机跑 Plugin/hook 相关 Eval 时，`CODEX_HOME` 隔离目录下会真实拉取第三方
插件内容，其中恰好含匹配 `*.test.ts`/`*.test.js` glob 的文件，被根 vitest 当作本仓库的正式
测试收集，报 "No test suite found"。

**根因**：与 [[vitest-collects-agent-worktree-copies]] 同一类问题——`vitest.config.ts` 的
`exclude` 只排了 `.repos/**`、`.claude/**`，没有 `e2e/repos/**`。`e2e/repos/*` 是独立测试
仓库（各自有自己的 `pnpm e2e` 验收流程，不归根 vitest 管），但 vitest 的文件发现不知道这条
边界，照单全收。

**修法**：`vitest.config.ts` 的 `exclude` 补上 `"e2e/repos/**"`。同类对账判据（见
[[vitest-collects-agent-worktree-copies]]）：`pnpm test` 报出的文件数应等于
`src/`+`test/` 下测试文件实际数量，多出来的就是收进了不该收的目录。
