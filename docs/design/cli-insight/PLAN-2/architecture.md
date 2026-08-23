# PLAN-2 —— Architecture

## Owner 边界

| Owner | 稳定责任 | 明确不拥有 |
|---|---|---|
| Record Host | 一次 `RecordReadSession` 内的 frozen Run / Core / Slot / Attempt 公开事实与 exact handle 查找 | 跨进程 catalog cursor、Analysis selector、formatter。 |
| Analysis Host | Selection Catalog、typed basis、exact selection audit、Sample、Population、multi-set alignment、comparability 与 closed values | CLI argv、Human 文案、Insight 页面。 |
| Query CLI | Subcommand、request / response codec、分页调用、stdout / stderr 与 correction argv | 可选对象定义、统计计算、Record inventory。 |
| Show CLI | 第一方 recipe 选择与 terminal formatter | 任意 query protocol、Page 作者面。 |
| Insight Host | 本地 server、active revision、私有 RPC、watcher、session 与固定 UI | 公共浏览器 API、用户 route / component / export。 |

`AnalysisMaterializer` 不构成新的领域层。CLI 与 Insight 复用现有 Analysis Host operation；multi-set comparison 是 Analysis 新能力，不是为外部网页 transport 提前抽出的泛化内核。

## Analysis Selection Catalog

Record Host 在一个 frozen view 中枚举 published Run / Core 与可公开的 Slot / Attempt handles。Analysis Host 把这些事实、启动时 target identity、selector definitions 与 capability identities 关闭为 `AnalysisSelectionCatalogSnapshot`。

`selectionSnapshotIdentity` 是 canonical public catalog bytes 的内容身份。它不包含 Record path、runtime generation、Scope token、reader、时间或进程随机值。

Catalog entry 按 `kind + public identity` canonical 排序。Cursor 绑定：

- selectionSnapshotIdentity；
- canonical discover request identity；
- after kind 与 public identity。

下一次 CLI 进程重开 Record view 并重算完整 catalog identity。Identity 不一致时分页失败；不能把两代 catalog 拼接。

Discovery snapshot 不锁定 query execution。`query run` 打开新的 frozen view，重新查找 exact handles。要复现 discovery 时刻的成员集，caller 必须把全部 exact handles 写入 request。

`niceeval record list` 保持独立恢复功能。它不分页、不筛选、不创建 Analysis catalog，也不被 query 调用。

## Typed selection

Analysis selection basis（Analysis 选择基准）说明 selection member 是 `logical-slot` 还是 `attempt`。Multi-set analysis（多集合分析）只能组合 basis 与 Population capability 兼容的 sets。

每个 source kind 固定 member basis。每个 Population capability 穷尽列出支持的 basis；不匹配在 Attachment I/O 前失败。

Selector 由 Analysis 注册并声明：

- stable ID 与 behaviorVersion；
- 可读的 secret-free identity / context field；
- 允许的 source basis；
- `eq | in`，以及是否额外支持 hierarchical `prefix`；
- input JSON Schema 与 canonical equality。

Selector 不能读取 Analysis 执行结果。Predicate 在 Sample 形成前执行，未纳入成员仍进入 exact selection audit，不靠删除 row 隐藏范围变化。

## Multi-set operation

一次 operation 的顺序固定为：

```text
open one RecordReadSession and freeze view
  → resolve every exact handle and predicate
  → validate set names, basis, Population, descriptors, alignment and Relation
  → open one Sample per set inside one parent Scope
  → close set frames with bounded concurrency
  → close exact or paired comparability
  → canonicalize result by set name
  → close all Samples and the Record session
```

Name、basis、Population、alignment、Relation、descriptor identity 与 public handle 必须在任何 Attachment I/O 前完成结构验证。

Request invalid、Sample open failure、无法完成 comparability 或 paired 任一结构缺失时，整个 operation 失败，不返回半份比较。`MetricValue.partial | unsupported | failed` 与闭合 Analysis issues 是成功领域值，不升级为 operation failure。

中断、失败和成功都关闭全部 Sample、in-flight work 与共享 Record session。并发完成顺序不影响 response 顺序或 canonical bytes。

## Alignment

- **Side-by-side**：分别关闭每个 set 的 frame、Population、denominator 与 audit，`derivedComparison` 固定为 false。
- **Exact**：先证明所有 set 的 Population identity 和 exact member-set identity 相同，再返回逐 set frame。不同 Measure 仍按自己的 identity 呈现，不自动产生派生比较。
- **Paired**：Relation 明确左右 set、左右 Population 与 pair Population。左右 frame、pair frame、三份 denominator、unmatched 与 excluded 原子形成。

Producer compatibility、Measure identity 与 selection basis 都进入 comparability。Display label、共同 Eval 名称、数值接近或数组顺序不能替代这些证明。

## Show recipe

Show recipe 是由 NiceEval 发布的版本化输入组合，不是用户 Report：

```text
human selector
  → canonical Analysis request
  → closed Analysis value
  → first-party terminal formatter
```

Recipe 与 machine query 可以调用同一个 Analysis operation，但不共享 public formatter。Show 不从 machine JSON 反序列化，也不建立第二个 selection 或 aggregation。

## Insight revision

一个 Insight 进程只有一个 server-global `InsightRevision`。Revision 持有固定 target/catalog identity 与一个或多个 pinned Samples；所有浏览器 session 和标签页读取同一 active revision。

每个 RPC 都携带 revision identity。新 revision 切换后，旧请求被取消；晚到响应因 identity 不匹配而丢弃。Navigation 与 locale 是 session-local UI state，不创建新 revision。

Insight 私有 view model 可以按需加载 trace、diff、source 与 artifact，但这些结果仍由 Analysis DomainView 关闭。私有 transport 不能重算 Population、Measure、missing、Evidence 或 comparability。

## 外部网页隔离

本架构不发布 Browser reader、query endpoint、Insight RPC、session protocol、Page ABI、React component 或 static writer。用户网页的公共接入面由[独立决策](../../benchmark-web-consumption/README.md)裁决。
