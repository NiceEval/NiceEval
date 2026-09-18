---
format: concord.document/v1
id: docs-result-outcome-field-doesnt-exist
title: docs-result-outcome-field-doesnt-exist
createdAt: 2026-07-12T17:22:55+08:00
createdAtSource:
  kind: first-recorded
  path: memory/docs-result-outcome-field-doesnt-exist.md
  commit: 308d23b208c6047ef78719ba5f10b7bbfd4e3d02
description: 英文 docs-site 多篇示例代码用 result.outcome 判定通过/失败，真实字段名是 verdict，照抄会静默失效
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
    statement: "**修法**：已修——三处代码示例 + Braintrust metadata 描述全部改回 `verdict`(在
      attempt-evidence-feedback-loop 重构收尾的英文文档同步扫描中顺带发现并修复,与
      locator/execution-tree 这批新概念无关,是更早就存在的独立文档 bug)。"
    proof: []
    source:
      path: memory/docs-result-outcome-field-doesnt-exist.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:94bd62214636c14145ad10a2e5156c2ebf458d18abcf3f2f19743fe111598093
---

**现象**：`docs-site/guides/custom-reports.mdx`、`docs-site/guides/reporters.mdx`、`docs-site/guides/results-data.mdx`
（均为英文入口）的多处示例代码用 `result.outcome === "failed"` / `attempt.result.outcome === "passed"`
判定判定,`reporters.mdx` 里 Braintrust reporter 一节的 metadata 字段列表也写着 `outcome`。这个字段
在 `EvalResult` 上从未存在过——照抄这些示例写自定义 `Reporter` 或计算脚本,条件恒为
`undefined === "failed"` = `false`,不报错、不崩溃,只是永远不触发对应分支,是典型的静默失效。

**根因**：真实字段名是 `verdict`(`src/runner/types.ts` 的 `EvalResult.verdict: Verdict`),`src/runner/reporters/braintrust.ts:149` 也是 `verdict: result.verdict`。`outcome` 从来不是这个仓库任何版本用过的字段名,推测是撰写英文文档时凭直觉/记忆写错(同类问题见 [codex-agent-env-var-doc-drift](codex-agent-env-var-doc-drift.md)),中文文档与 `docs/` 全部正确,只有这几篇英文入口有此错。

**修法**：已修——三处代码示例 + Braintrust metadata 描述全部改回 `verdict`(在 attempt-evidence-feedback-loop 重构收尾的英文文档同步扫描中顺带发现并修复,与 locator/execution-tree 这批新概念无关,是更早就存在的独立文档 bug)。
