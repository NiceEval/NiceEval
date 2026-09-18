---
format: concord.document/v1
id: show-skipped-version-hint-missing
title: show-skipped-version-hint-missing
createdAt: 2026-07-12T14:40:39+08:00
createdAtSource:
  kind: first-recorded
  path: memory/show-skipped-version-hint-missing.md
  commit: 16d78ee1fceff73ab88dcc64310ebc61db3cd5b1
description: niceeval show 遇到 schemaVersion 不兼容的落盘时不给版本/npx 建议，只逐条报
  reason；niceeval view 早就做了
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
    statement: '**修法**（已修）：新增中性分组函数
      `groupIncompatibleVersionSkips`（`src/results/skipped-notice.ts`，从
      `src/results/index.ts` 导出），把 `incompatible-version` 且 `producer.name ===
      "niceeval"` 的 skipped 目录按 `(producer.version, schemaVersion)` 分组。`show`
      侧格式化在 `src/show/render.ts` 的 `skippedRunsText`：**不能照抄 view
      的"逐条给命令"**——`show --run` 认的是结果根目录（其下可以有多个
      experiment），不是单个快照目录，`SkippedDir.dir` 只有单个快照路径，所以 `show` 只能给「按版本分组、每组一条
      `npx niceeval@<version> show --run <结果根>`」，同版本的多份快照合并成一行；`view`
      则保留逐条给（它支持精确打开某一份快照，这是它的正确行为，不是待改的重复）。第三方 harness（`producer.name !==
      "niceeval"`）或版本信息缺失时不参与分组，原样逐条列出，不编 npx 建议。`docs/view.md` 补了一段跨引用说明这套机制是
      results 层通用能力、show/view 各自的命令语法差异。'
    proof: []
    source:
      path: memory/show-skipped-version-hint-missing.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:bce8c4f9f4fe647ee6aabe837d9eb909e7774fa42e721552842be788149a599c
---

**现象**：`niceeval show` 在结果根下全部落盘都读不了时（`results.experiments.length === 0`），错误信息只逐条打印 `skipped <dir> (<reason>)`——`incompatible-version` 场景下完全没有提示"这份落盘是哪个 niceeval 版本写的、该用哪个版本的命令去看"。在真实外部仓库（`coding-agent-memory-evals`，schemaVersion 4→5 破坏性升级后）复现：15 份 skipped 落盘刷屏 15 行几乎一样的 `(incompatible-version)`，没有一条可执行的下一步。

**根因**：`niceeval view`（`src/view/data.ts` 的 `incompatibleViewCommand`/`noReadableResults`）早就正确读取了 `SkippedDir.producer`/`schemaVersion` 字段，拼出 `npx niceeval@<version> view <dir>` 建议，`docs/view.md`"结果版本机制"一节也把这套机制记成了正式契约。但 `niceeval show`（`src/show/index.ts` 的 no-results 分支）从来没有接上——只用了 `SkippedDir.dir`/`.reason`，完全没碰 `.producer`/`.schemaVersion`。这不是这次 attempt-evidence-feedback-loop 重构引入的新 bug，是 `show` 命令自 `SkippedDir` 带上 `producer`/`schemaVersion` 字段以来就一直存在的功能空缺——只是历史上很少真的触发全部 skipped 的极端场景，这次 schemaVersion 4→5 的破坏性升级第一次让它在外部验收里被真实撞见。

**修法**（已修）：新增中性分组函数 `groupIncompatibleVersionSkips`（`src/results/skipped-notice.ts`，从 `src/results/index.ts` 导出），把 `incompatible-version` 且 `producer.name === "niceeval"` 的 skipped 目录按 `(producer.version, schemaVersion)` 分组。`show` 侧格式化在 `src/show/render.ts` 的 `skippedRunsText`：**不能照抄 view 的"逐条给命令"**——`show --run` 认的是结果根目录（其下可以有多个 experiment），不是单个快照目录，`SkippedDir.dir` 只有单个快照路径，所以 `show` 只能给「按版本分组、每组一条 `npx niceeval@<version> show --run <结果根>`」，同版本的多份快照合并成一行；`view` 则保留逐条给（它支持精确打开某一份快照，这是它的正确行为，不是待改的重复）。第三方 harness（`producer.name !== "niceeval"`）或版本信息缺失时不参与分组，原样逐条列出，不编 npx 建议。`docs/view.md` 补了一段跨引用说明这套机制是 results 层通用能力、show/view 各自的命令语法差异。
