---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Verdict

Verdict 是一个 Attempt 的读侧终态解释。它把 Core `outcome`、sealed Assertions 和显式 skip 折叠为 `passed`、`failed`、`errored` 或 `skipped`。

折叠从 execution outcome 和已封口的 Assertion facts 离线进行。它不重新运行 Match、
不根据最后一个 Turn 推断，也不为 Judge 建立例外。

通过制与计分制都按同一输入折叠四态 Verdict。Score Eval 的 earned score、complete、partial 或 unavailable 都是 sealed Assertions 的 score facts；Verdict 与 score 都从各自的源事实读取。Assertions 的 `points` 只是 Score Eval 内的挣分，不是 `evaluationKind`。

Core 是 execution outcome 的 owner，Assertions 是 condition 与 score facts 的 owner。是否复用由具名 reuse planning 在读取这些事实后，再比较 Core combined execution identity 与真实 Observability duration 决定；缺失或不完整事实形成 gap。

## 从哪里开始

- [Architecture](architecture.md)：四态折叠、事实 owner 和读取规则。
- [Assertions](../assertions/README.md)：断言怎样形成输入。
- [缓存与携带](../experiments/cache.md)：planner 怎样使用 Verdict 折叠与真实时长。
- [Reports](../reports/README.md)：页面怎样呈现状态和完整度。
