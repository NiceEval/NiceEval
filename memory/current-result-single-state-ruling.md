# 当前结果收敛为单一状态

日期：2026-08-06。

## 裁决

默认 show、view 与 Reports 只消费一份 `currentSample.attempts`。
本次执行、携带合入和来自可比旧 Run 的 Attempt 同等计票；`carried` 只保留为 Attempt provenance。

不同配置的旧结果不再以 `stale` 半状态进入当前报告。
当前没有 Attempt 时，coverage 用 `never-run` 或 `previous-result` 解释缺口；旧 verdict 不进入聚合。
用户确认旧结果仍适用时显式执行 `niceeval accept @<locator>` 重锚。

## 被替代的设计

删除 `Sample.fresh`、`freshOnly()`、CLI `--fresh`、报告内“只看新执行”开关，以及
fresh / historical / stale / not-run 四段覆盖构成。
删除 Run 持久化的 `selectedEvalIds` / `evalFilterFingerprint`；运行期选题计划仍供调度、dry 与 lifecycle 使用，
Reports 不再读取规划字段二次筛选物理结果。

原因是这些维度把来源、配置兼容性和缺失事实混成多套报告水位。
没有独立用户旅途的来源差异不应成为状态或过滤器。
