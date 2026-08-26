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
Record Host → fixed Inspection operations → query | fixed Web View renderer
                                                  ↓
                                      immutable ViewRevision → loopback | official Preview
       ↓
record snapshot → portable sealed-only RecordSnapshot
```

## 边界

Record 是唯一的持久事实 owner。Inspection 是唯一的 selector、sealed cutoff、partial、missing、issues、Evidence 与 comparison owner。Delivery 不读 facts 以补算语义。

对已 pin 的 sealed synthetic `RecordSnapshot`，主仓的固定 Web View renderer 会产出 immutable、byte-complete 的多文件 `ViewRevision`。

它固定包含 `overview`、`run`、`attempt`、`compare`、`sources` 与 `artifacts` 页面。它不接受任意 route、operation 或页面选择。

byte-complete 指每个规定页面及其资源都在 revision 中，不要求把无界 Record payload 写入静态文件。超过固定 delivery limit 的内容必须保留明确的 `truncated` 状态、截断边界与可见的后续读取方式。不得静默删除、重排或把它写成完整结果。delivery 的截断不改变 Inspection 已关闭的 `partial`、`missing`、`issues` 或 Evidence。

`ViewRevision` 只是固定 Delivery 的不可变文件集合，不是新的 Record 持久格式、用户可用的 static export，也不是可定制 Report。它 transport-neutral，绝不含 loopback session、fragment credential 或其它 session auth。

`query` 把 operation result 编码为 `niceeval.query/v1`。

本地 `view` 用 loopback lifecycle 围住固定 UI。对于同一个 pinned synthetic Snapshot，它服务的 `ViewRevision` 与公开 Preview 服务的 revision bytes 完全相同。

二者只在 transport 上不同。loopback 在文件之外验证本地 session、Host 与 Origin；公开 Preview 仅静态交付 revision，不把该 session auth 带入文件。

query 与 Web View 不共享 formatter、view model、route、component、renderer、theme 或 presentation schema。

## Source

没有 `--record` 时 Host 定位 project operational Store，每次读取只见 sealed cutoff；View 可在用户确认时 refresh。给出 `--record` 时 Host 只接受 `record snapshot --output` 导出的 `RecordSnapshot`。Host 验证 artifact kind、revision、content identity、export provenance、logical closure identity 与 exact Seal。Snapshot View 不 watch、不 refresh，Inspection 不隐式迁移。

Snapshot 可复制给能运行兼容 NiceEval runtime 的接收者。它本身不产生用户 static export、离线网站或任意匿名 URL；storage sanitization 也不等于业务脱敏。

唯一的部署例外是官方 `NiceEval-Preview`：其 `main` 精确 pin NiceEval candidate SHA，只将该候选生成的 `ViewRevision` files 发布给公开 Preview，以做部署与视觉 dogfood。它不得发布 SQLite、Inspection JSON、`.niceeval`、Snapshot 或 secrets，也没有 Functions 或长期 Node。这个公开 URL 不是用户分享功能，不能接收自定义 Report、Page、component、theme、renderer 或任意 operation；候选 SHA 是 Preview 对渲染字节的信任边界，不为底层 Record 内容背书。

NiceEval 主仓 PR 不拥有 Preview deploy check；新的 Netlify site 与 check 归 `NiceEval-Preview`。新站验活后，旧 site/check 由其外部 owner 解除。

## 相关阅读

- [Record](../record/README.md)
- [Inspection 与第一方 Delivery](../reports/README.md)
