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

query 与 Web View 不共享步骤、formatter、view model、route、component、renderer、theme 或 presentation schema。它们只独立消费同一闭合 operation result。

## Snapshot 与刷新

未给 `--record` 的入口由 Host 定位 project operational Store，只读取 sealed cutoff。View 可以发现新 sealed publication 并由用户确认 refresh。`--record` 只接受 `record snapshot --output` 导出的 `RecordSnapshot`；它固定 exact Seal，既不 watch 也不 refresh。

固定 Web View 对 pinned sealed synthetic Snapshot 生成 immutable、byte-complete、多文件 `ViewRevision`。它固定包含 `overview`、`run`、`attempt`、`compare`、`sources` 与 `artifacts`。

每个 revision 都带固定 delivery limit。超限内容显式为 `truncated`，并保留边界与继续读取的固定路径；不得静默省略或把交付截断误报为 Inspection 的完整性状态。

该 revision 在本地 loopback 与官方公开 Preview 中逐字节一致。loopback session auth 只属于 transport，不能写进 revision。

因此，静态 Preview、导出目录、匿名 URL 与离线分享并非一概被排除。唯一属于本 Feature 的例外是主仓 `main` 与 PR 的官方 Preview。

Netlify 从 exact NiceEval checkout 构建。主仓命令固定一个 `NiceEval-Preview` orchestrator commit，并把当前 candidate 的 exact package artifact 安装到 disposable consumer。

它只发布 `ViewRevision` files，供该 exact checkout 的部署与视觉 dogfood。不发布 SQLite、Inspection JSON、`.niceeval` 或 secrets，也不使用 Functions 或长期 Node。

它不是新的持久格式、用户 static export 或可定制 Report。用户不能借此提供自定义 Report、Page、component、theme、renderer、任意 route 或 operation，也不能把任意匿名 URL 当成第一方 Delivery。

Preview 的 Netlify site、稳定 `main` 与 PR deploy check 都归 `NiceEval/NiceEval`。`NiceEval-Preview` 只拥有被精确 pin 的 fixture/build/verify 源码，不保存反向 candidate pin 或部署触发器。PR alias 只是浏览入口；验收必须绑定 current head 的绿色 check 与 immutable deploy-ID URL。

- [CLI](cli.md)
- [Architecture](architecture.md)
- [Use cases](use-case/README.md)
