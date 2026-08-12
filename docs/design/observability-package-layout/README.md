# Observability package layout

本决策比较 Observability facts 在 RecordAttachment 中的物理切分。它不改变 Record Core、owner、
locator、closure 或 migration 公理，也不按 Report 想显示的列反向设计持久层。

本决策只提供 layout-specific state，不拥有通用 Projection API。Projection 的参数化读取结果允许两个决策
独立比较；Receipt、representation 与 physical package kind 只存在于 PLAN-2 的 state 参数中。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1：七个逻辑 family](PLAN-1/README.md)
- [PLAN-2：按采集权威切 physical packages](PLAN-2/README.md)
- [Decision](DECISION.md)
