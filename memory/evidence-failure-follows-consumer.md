# 裁决：证据采集失败后果跟随消费者

- **裁决**（2026-08-02）：证据通道是否能改变 Verdict，由本 Attempt 已登记的断言消费者决定，不由采集阶段或 artifact 名决定。非 optional 消费者使通道 required；optional 消费者与纯报告 artifact 是 supplemental。
- **起因**：Terminal-Bench 的 `git-multibranch`、`play-zork-easy` 与 `regex-log` 已取得官方测试命令结果，随后 E2B Sandbox 消失，未被任何断言消费的 `workspace.diff` 导出失败却把 Attempt 改成 `errored`。
- **修正**：required diff 失败形成 unavailable 并按 Verdict 规则折叠；supplemental diff 失败写 `workspace-diff-unavailable` diagnostic、不给空 artifact、继续 finalize 其它断言。OTel span 不参与断言，配置与收集失败始终是 supplemental。
- **推翻**：`telemetry-configure-failure-stays-errored.md` 的全局 fatal 裁决，以及 `diff-export-budget-counts-transferred-bytes.md` 中“采集失败不按消费面处理”的部分。环境缺陷仍须大声报告，但报告严重度不能越过证据依赖改写判定。
- **实现边界**：Assertion collector 暴露证据需求快照；Runner 只采集一次并按最高需求处理。普通 TypeScript 值流里直接读取 `t.sandbox.diff` 时保守登记 required，因为框架无法反推后续是否链 `.optional()`。
