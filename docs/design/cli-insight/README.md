---
format: niceeval.docs-node/v1
kind: design
relations:
  selectedPlan: docs/design/cli-insight/PLAN-3/README.md
---

# CLI Query、Show 与 View —— Design Decision

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [DECISION](DECISION.md)

本决策裁决 NiceEval 自己维护的运行后入口。AI 与自动化使用 machine-only `query`；人可用
英文终端 `show` 或第一方浏览器 `view`。三者只共享固定 Inspection operation 的业务语义，
不共享 formatter、view model、路由、组件、renderer、theme 或 presentation schema。

```text
Record Host → fixed Inspection operations
                ├─ niceeval query
                ├─ niceeval show
                └─ niceeval view

niceeval record snapshot → portable sealed-only RecordSnapshot
```

`view` 是运行时 View，不生成静态网站、匿名 URL 或离线页面。共享只通过 `RecordSnapshot` 加兼容的 NiceEval runtime 发生。外部网页怎样消费 NiceEval 数据，仍属于[自定义 Benchmark 网页接入面](../benchmark-web-consumption/README.md)的独立决策。

## 已定边界

- `niceeval query` 是 machine-only 协议，只有 `discover`、`explain` 与 `run`。
- `niceeval show` 是受限的英文终端 renderer；`niceeval view` 是浏览器人读入口。
- source 与 selection 正交。未给 `--record` 时 Host 定位项目 operational Store；给出 `--record` 时只读取 Host 导出的 sealed-only `RecordSnapshot`。
- 固定 Inspection operation 关闭 selector、sealed cutoff、partial、missing、issues、Evidence 与 comparison。Delivery 不重算这些语义。
- `niceeval record snapshot --output <snapshot>` 是唯一可移植输入的形成方式。snapshot 不是 ordinary operational copy。

本决策选择 [PLAN-3](PLAN-3/README.md)。原决策删除 `show` 的子决策已翻案：恢复的只是
fixed Inspection renderer，不恢复旧 Report 作者树、静态导出或自由统计。

## 候选

| 候选 | Machine 面 | 人类面 | 状态 |
|---|---|---|---|
| [PLAN-1](PLAN-1/README.md) | 从 Report / Page 派生 | 共享作者树 | 未选。 |
| [PLAN-2](PLAN-2/README.md) | 通用 Analysis protocol | `show` 与 Insight | 未选。 |
| [PLAN-3](PLAN-3/README.md) | 固定 operation catalog | 受限 terminal Show 与固定 runtime View | 已选。 |
