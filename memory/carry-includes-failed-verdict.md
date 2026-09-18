---
format: concord.document/v1
id: carry-includes-failed-verdict
title: carry-includes-failed-verdict
createdAt: 2026-07-11T18:50:46+08:00
createdAtSource:
  kind: first-recorded
  path: memory/carry-includes-failed-verdict.md
  commit: fbe2538377a35f2362e8f5734268448445f0e2ff
description: 设计裁决 — resume/carry 缓存现在同时携入 passed 与 failed,只有 errored 才重跑
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---

**裁决**(2026-07-11):跨快照 resume(`src/runner/run.ts` 的 `priorRunKeys` 携入逻辑)的携入条件从「上次 `verdict === "passed"` 且 fingerprint 匹配」改为「上次 `verdict === "passed" || "failed"` 且 fingerprint 匹配」。`errored` 与 `skipped` 依旧总是重跑。

**曾选方案**:只有 `passed` 才携入,`failed`/`errored` 一律重试(2026-07-11 之前的行为,`docs/runner.md` 曾写「失败的结果不缓存(总会重试失败项)」)。

**否决理由**:`failed` 和 `passed` 一样是"跑完了、判定确定"的终态——agent 确实完整跑了一遍,断言/judge 也确实给出了判定,没有理由假设重跑会得到不同结果而白花一次 agent/sandbox 成本去复现同一个已知失败。真正该重试的是 `errored`:框架/环境层面的不确定失败(超时、沙箱异常、judge 探测失败),判定本身不可信,不代表 agent 行为的真实样本。

**How to apply**:改动落在 `src/runner/run.ts` 的 carry 条件(`isTerminalVerdict = passed || failed`);同步点见 `docs/runner.md`、`docs/cli.md`、`docs-site/{,zh/}guides/runner.mdx`、`src/i18n/{en,zh-CN}.ts` 的 `runner.resumeCarry` 文案(不再说"passing"/"通过的",改成中性的"settled"/"已判定")。`memory/rerun-with-eval-filter-partial-snapshot.md` 里旧的"只携入 passed"表述已同步更正,不要再假设只有 passed 会被携入。
