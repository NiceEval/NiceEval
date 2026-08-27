# PLAN-1：共享双面 Report 作者面

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 核心形状

CLI、terminal 与 browser 都先执行用户 `ReportDefinition`、Page 与双面 component。`show` 选择一个 Page，`view` 关闭整站；machine JSON 从同一次 Page execution 或作者树派生。

```text
Record → Analysis → Report Page/component
                         ├─ terminal
                         ├─ machine document
                         └─ browser/static site
```

## 优点

- 作者只写一份结构，三个呈现面可以共享标题、顺序与显示组件。
- 用户能直接扩展 Page、route、theme 与静态站点。

## 结构性代价

- Agent 只能查询作者预先写成 Page 的问题，不能自由选择历史 sets、Population、Measure 与 Relation。
- Machine schema 被 Page 和 renderer 的演进牵动，discovery 无法形成稳定能力目录。
- `show` 为了复用网页作者树承担 route、component 与 rendering 生命周期。
- `view` 同时是本地排障工具、用户站点预览和静态发布器，任何一面都会限制另外两面。
- 组件中的排序、过滤或二次聚合容易成为 Analysis 之外的第二套统计语义。

## Cases

本方案可以完成 C5–C7 的基本查看，但无法完整兑现 C1–C4 的自由机器查询，也无法让 C8–C10 的本地 Insight 生命周期独立于公共作者 ABI。
