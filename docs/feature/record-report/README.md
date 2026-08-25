---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Record → Inspection → 第一方 Delivery

NiceEval 的运行后数据流只有三层：Record 封口 durable facts；Inspection operations 关闭读取语义；Delivery 将闭合结果给 machine query 或人类 View。中间没有 Report、统计或呈现作者层。

```text
sealed Record facts
       ↓
Record Host → fixed Inspection operations → query | view
       ↓
record snapshot → portable sealed-only RecordSnapshot
```

## 边界

Record 是唯一的持久事实 owner。Inspection 是唯一的 selector、sealed cutoff、partial、missing、issues、Evidence 与 comparison owner。Delivery 不读 facts 以补算语义。

`query` 把 operation result 编码为 `niceeval.query/v1`。`view` 用自己的 loopback lifecycle 与固定 UI 显示结果。两者不共享 formatter、view model、route、component、renderer、theme 或 presentation schema。

## Source

没有 `--record` 时 Host 定位 project operational Store，每次读取只见 sealed cutoff；View 可在用户确认时 refresh。给出 `--record` 时 Host 只接受 `record snapshot --output` 导出的 `RecordSnapshot`。Host 验证 artifact kind、revision、content identity、export provenance、logical closure identity 与 exact Seal。Snapshot View 不 watch、不 refresh，Inspection 不隐式迁移。

Snapshot 可复制给能运行兼容 NiceEval runtime 的接收者。它不产生静态页面、离线网站或匿名 URL；storage sanitization 也不等于业务脱敏。

## 相关阅读

- [Record](../record/README.md)
- [Inspection 与第一方 Delivery](../reports/README.md)
