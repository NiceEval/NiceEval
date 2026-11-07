# Judge 审计预算累计上限未在随包配置入口说明，长任务结束后才触发留存错误

## 观察

NiceEval-Eval 的两道真实安装 Attempt 在目标应用已产生业务结果、真实响应 gate 已通过后，登记末尾评分时抛出 `Attempt Assertion retention cannot exceed 64 MiB`。两项分别运行约 46 分钟，最终外层记录为 errored；这不是目标应用响应失败。

现有 helper 为每个 `defineJudge` 配置 `maxMaterialBytes: 512 * 1024` 和 `maxAuditBytes: 2 * 1024 * 1024`。用实际安装候选的公共 CLI，34 项仅含小字符串材料的 `t.judge(...).score(1)` 就能确定性复现同一错误，证明不必真的产生 64 MiB 的业务文本。外部裁判只用本地 HTTP fixture，未 mock NiceEval 的评分或留存实现。

删除显式审计预算后，小材料通过，但 60 KB 与 300 KiB 材料得到 `unavailable / score-match-audit-budget`，理由是审计预算无法保留 definition、input 和 terminal result。每项配置 1 MiB 后，34 项、每项 300 KiB 材料完整结算为 34/34。下游已采用 1 MiB 并新增回归测试；没有提高全局上限或截断材料。

## 文档缺口与期望

随包 Judge 概念页说明材料快照与审计，但没有说明 Attempt 64 MiB 总预留边界、每个 Judge 的审计上限怎样累计、以及 `maxMaterialBytes` 与 `maxAuditBytes` 应一起考虑。作者容易为单项大材料放宽预算，却直到高成本真实任务结束后才触发整体登记错误。

请在预算配置入口明确默认值、累计规则、材料与审计的关系，以及多项评分的可运行示例。错误诊断若能包含已预留值、当前请求值及相关 Assertion key，也能避免误判为真实日志异常膨胀。无需把扩大总限制作为预设解决方案。

## 公开复现与验证身份

Eval 的核心复现为：循环 34 次，调用 `t.judge({text: 'small'}, defineJudge({name: 'check-' + i, rubric: '...', anchors: [{measurement: 0, description: 'N'}, {measurement: 1, description: 'Y'}], maxMaterialBytes: 512 * 1024, maxAuditBytes: 2 * 1024 * 1024})).score(1)`。通过 `niceeval exp local --json` 执行，公开 query 读取 Run/Attempt。无需 coding agent、云沙箱或付费模型。

候选 `niceeval@0.0.0-development`，SHA-256 `21ebcc8e00897576056fe2a723fa08499fe01b2a15684c00826a95a8344f5d38`。Linux、pnpm 11.12.0。该候选包含已修复的长文本断言详情读取行为，不修改评分预算实现。下游回归入口为 NiceEval-Eval 的 `scripts/test-judge-retention.ts`。

已检索 NiceEval/NiceEval open 与 closed Issues 的 `retention budget` 和 `64 MiB`，无返回结果。建议标签：`documentation`、`area:assertions`、`needs-triage`。仅保存本地草稿，不发布远端 Issue。
