---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# ③ Inspection 与第一方 Delivery

Reports 保留既有 Feature 身份，但它定义固定的运行后 Inspection 与两条第一方 Delivery：机器用 `query`，人用 `view`。它不是 Report、Analysis、Page 或组件作者框架。

```text
Record → fixed Inspection operations → query | view
```

## 产品面

| 入口 | 用户得到 | 固定责任 |
|---|---|---|
| `niceeval query` | `niceeval.query/v1` document | discovery、具名 request/result、correction |
| `niceeval view` | loopback browser View | overview、detail、operational refresh、session lifecycle |
| `niceeval record snapshot` | sealed-only portable artifact | exact sealed Record input |

Inspection catalog 包含 `runs.list`、`run.get`、`run.summary` 与 `attempt.get`。它还包含 `attempt.trace`、`attempt.diff`、`attempt.sources`、`attempt.artifacts` 与 `runs.compare`。新问题必须新增 operation 或扩展其穷尽 union，不能临时注册统计、关系、SQL、JSON path 或 formula。

## 一个语义 owner

operation 在 Delivery 之前关闭 source、selection、sealed cutoff、partial、missing、issues、Evidence 与 comparison。`runs.compare` 仅支持 `side-by-side`、`exact`、`paired`。Delivery 不重新选择、补配、隐藏缺口或从 scalar 重算业务判断。

query 与 View 不共享步骤、formatter、view model、route、component、renderer、theme 或 presentation schema。它们只独立消费同一闭合 operation result。

## Snapshot 与刷新

未给 `--record` 的入口由 Host 定位 project operational Store，只读取 sealed cutoff。View 可以发现新 sealed publication 并由用户确认 refresh。`--record` 只接受 `record snapshot --output` 导出的 `RecordSnapshot`；它固定 exact Seal，既不 watch 也不 refresh。静态 Preview、导出目录、匿名 URL 与离线分享不属于本 Feature。

- [CLI](cli.md)
- [Architecture](architecture.md)
- [Use cases](use-case/README.md)
