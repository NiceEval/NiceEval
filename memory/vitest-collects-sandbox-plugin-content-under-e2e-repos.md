---
format: concord.document/v1
id: vitest-collects-sandbox-plugin-content-under-e2e-repos
title: vitest-collects-sandbox-plugin-content-under-e2e-repos
createdAt: 2026-07-19T08:35:09+08:00
createdAtSource:
  kind: first-recorded
  path: memory/vitest-collects-sandbox-plugin-content-under-e2e-repos.md
  commit: 56e51eec8d972972b4f6c74eb82a2a9b2d3e1a5c
description: 根 vitest 曾把 e2e/adapter/codex-sdk/.codex-home/
  下真机拉取的第三方插件内容当成正式测试跑，同类问题见 [[vitest-collects-agent-worktree-copies]]
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [vitest-collects-sandbox-plugin-content-under-e2e-repos](vitest-collects-\
      sandbox-plugin-content-under-e2e-repos.md) —
      同类问题:`e2e/adapter/codex-sdk/.codex-home/` 下真机拉的第三方插件内容含 `*.test.ts`,被根
      vitest 当正式测试跑;修为 exclude 补 `e2e/adapter/**`"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**：`pnpm test` 报出 4 个失败文件，全部路径形如
`e2e/adapter/codex-sdk/.codex-home/.tmp/plugins/plugins/<third-party-plugin>/**/*.test.ts`——
`codex-sdk` E2E 仓库真机跑 Plugin/hook 相关 Eval 时，`CODEX_HOME` 隔离目录下会真实拉取第三方
插件内容，其中恰好含匹配 `*.test.ts`/`*.test.js` glob 的文件，被根 vitest 当作本仓库的正式
测试收集，报 "No test suite found"。

**根因**：与 [[vitest-collects-agent-worktree-copies]] 同一类问题——`vitest.config.ts` 的
`exclude` 只排了 `.repos/**`、`.claude/**`，没有 `e2e/adapter/**`。`e2e/adapter/*` 是独立测试
仓库（各自有自己的 `pnpm e2e` 验收流程，不归根 vitest 管），但 vitest 的文件发现不知道这条
边界，照单全收。

**修法**：`vitest.config.ts` 的 `exclude` 补上 `"e2e/adapter/**"`。同类对账判据（见
[[vitest-collects-agent-worktree-copies]]）：`pnpm test` 报出的文件数应等于
`src/`+`test/` 下测试文件实际数量，多出来的就是收进了不该收的目录。
