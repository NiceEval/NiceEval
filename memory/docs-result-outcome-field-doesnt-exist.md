# docs-result-outcome-field-doesnt-exist

英文 docs-site 多篇示例代码用 result.outcome 判定通过/失败，真实字段名是 verdict，照抄会静默失效

**现象**：`docs-site/guides/custom-reports.mdx`、`docs-site/guides/reporters.mdx`、`docs-site/guides/results-data.mdx`
（均为英文入口）的多处示例代码用 `result.outcome === "failed"` / `attempt.result.outcome === "passed"`
判定判定,`reporters.mdx` 里 Braintrust reporter 一节的 metadata 字段列表也写着 `outcome`。这个字段
在 `EvalResult` 上从未存在过——照抄这些示例写自定义 `Reporter` 或计算脚本,条件恒为
`undefined === "failed"` = `false`,不报错、不崩溃,只是永远不触发对应分支,是典型的静默失效。

**根因**：真实字段名是 `verdict`(`src/runner/types.ts` 的 `EvalResult.verdict: Verdict`),`src/runner/reporters/braintrust.ts:149` 也是 `verdict: result.verdict`。`outcome` 从来不是这个仓库任何版本用过的字段名,推测是撰写英文文档时凭直觉/记忆写错(同类问题见 [codex-agent-env-var-doc-drift](codex-agent-env-var-doc-drift.md)),中文文档与 `docs/` 全部正确,只有这几篇英文入口有此错。

**修法**：已修——三处代码示例 + Braintrust metadata 描述全部改回 `verdict`(在 attempt-evidence-feedback-loop 重构收尾的英文文档同步扫描中顺带发现并修复,与 locator/execution-tree 这批新概念无关,是更早就存在的独立文档 bug)。
