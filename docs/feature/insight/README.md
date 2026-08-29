---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Insight

Insight 是本机开发者审阅持续可读 Run 的第一方 debugger。`niceeval view` 启动 React SPA；浏览器在一次读取开始时
固定 `PublicationCutoff`，通过 Inspection 的固定 operation 呈现当时已经发布的 Run 与 Attempt 事实。

```text
published Run facts at PublicationCutoff
  → sqlite-wasm Worker facts adapter
  → fixed Inspection operation
  → React routes and components
```

View 不要求 Run 先进入终态。`active` Run 已发布的 Attempt 立即可读，尚未发布的 expected slot 显示 `pending`；
终态 Run 的空 slot显示 `absenceReason`。Run detail 只消费 `run.get`，列表只消费 `run.list`。Overview、指标、比较和
层级 table 同样只呈现 Inspection 已关闭的成员、分母与 Evidence，组件不自行聚合。

Insight 不是可定制 Report、component 或 service 作者面。它不提供持久 DTO、业务 REST、任意 SQL、任意 route，
或用户自带 renderer。

## 固定审阅体验

Header 右上角先显示 `Experiments` selector，再显示 `Language`。Overview 保留 Summary cards、指标、Experiment 比较和
Experiment → 可选 Eval 路径组 → Eval → Attempt 层级 table。Run identity 是 Attempt member 的 provenance；读者可以
按 exact Run identity 打开 Run debugger，或从 Attempt 行打开 Attempt debugger。

Run debugger 显示 state、`expected`／`published`／`missing`、pending/absence、coverage、指标分母、slot bindings 与
Attempt locators。Attempt debugger 连续呈现身份、判定、source、assertions、trajectory、tool input/output、timeline、
usage、commands、diagnostics 与 diff。partial、unavailable 与 truncated 始终是可见事实。

软导航以 drawer 或 modal 显示详情；关闭或 Back 回到原选择。复制的 Run 或 Attempt URL 在硬加载时显示完整详情。
语言只改变界面文案，不改变 cutoff、identity、URL 或读取结果。

页面可提示较新的 publication。只有用户确认 refresh 后，repository 才固定新的 `PublicationCutoff`、准备完整结果并
原子切换；失败时旧 cutoff 的 last-good 页面继续可读。同一次读取不会混合两个 cutoff。

- [CLI](cli.md)：`niceeval view` 的唯一命令面。
- [Architecture](architecture.md)：cutoff、loopback、Worker、repository、刷新与信任边界。
- [Use cases](use-case/README.md)：打开 Overview 与连续审阅 Run、Attempt。
