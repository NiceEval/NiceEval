# PLAN-2：独立 Query、Show 与固定 Insight

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md) · [CLI](cli.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md)

## 核心心智

```text
Record Host → Analysis Host
                ├─ multi-set query → machine codec → niceeval query
                ├─ first-party recipe → terminal formatter → niceeval show
                └─ pinned Sample(s) → private RPC → niceeval insight
```

三条入口只共享 Analysis 的 selection、Population、Measure、Relation、missing、Evidence 与 closed values。它们不共享 Page、React tree、formatter、route、transport 或生命周期。

## 产品面

| 入口 | 主要用户 | 稳定责任 | 明确不拥有 |
|---|---|---|---|
| `niceeval query` | Agent 与自动化 | discovery、版本化请求、自由比较、闭合响应、correction | Human formatter、网页。 |
| `niceeval show` | 终端用户 | Run 摘要、exact Attempt 诊断、可复制下一步 | 任意 query、JSON API。 |
| `niceeval insight` | 本地排障用户 | 固定 overview/detail、trace/diff/artifact、revision refresh | 用户 Page、组件 ABI、静态导出。 |

## 正确性门

- Analysis 先拥有 `AnalysisSelectionCatalogSnapshot`、typed basis、exact selection audit 与 multi-set operation。
- CLI request 只引用 discovery 已公布的 public handle、selector 与 descriptor。
- `side-by-side`、`exact`、`paired` 是穷尽 union，没有默认 alignment。
- formatter、Insight view model 与 machine codec 都不能新增聚合、分母、pairing 或 Evidence join。

## Cases

本方案完整兑现 [C1–C12](../CASES.md)。调用形状见 [CLI](cli.md)，owner 与比较原子性见 [Architecture](architecture.md)，Insight 启停、刷新和授权见 [Lifecycle](lifecycle.md)。

## 明确代价

- Analysis 要增加公开 selection catalog 与 multi-set comparison，而不是让 CLI 用 glue code 拼多个单 Sample 结果。
- `query` 与 `show` 不共享 formatter；想把任意机器请求转成人类报告属于新的产品问题。
- Insight 的私有 Web 实现仍需要完整 session、Origin、revision 与资源回收机制。
