# Observability Source receipts

Observability 的 durable facts 按 capture authority 分 family。Adapter、SessionManager、Sandbox wrapper 与 Runner 只能保存
自己亲历且有权解释的事实。conversation、usage、commands、timing 与 diagnostics 是 reader-side view，
不是另一组 durable table 或 aggregate family。

## 官方 families

| family | owner | capture authority | Content |
|---|---|---|---|
| `niceeval.agent-turns` | Attempt | Adapter terminal Turn | none |
| `niceeval.turn-contexts` | Attempt | SessionManager physical `t.send` context | none |
| `niceeval.sandbox-commands` | Attempt | Sandbox command lifecycle | stdout / stderr |
| `niceeval.runner-activities` | Attempt or Run | owner-local monotonic clock | none |
| `niceeval.runner-diagnostics` | Attempt or Run | Runner diagnostic sink | none |

这些 family 与第三方 family 使用相同 generic `attachments`、`collection_items`、`contents`、`content_chunks` 与
`attachment_references` rows。它们不拥有 table、index、transaction 或 SQLite connection，也不能要求 Host 按 family name
改变 physical schema。unknown family rows 可以留在 RecordSnapshot 中；只有需要解释该 family 的读取才要求 definition。

## Source completion

每份 source 显式表达：

```ts
type SourceCollection<Limitation> =
  | { readonly state: "complete"; readonly limitations: readonly [] }
  | {
      readonly state: "partial";
      readonly limitations: readonly [Limitation, ...Limitation[]];
    };
```

authority 未开始或不适用时是 `not-recorded`。观察到空集合仍应显式 close 为 `complete-empty`。安全前缀确有已知业务缺口时，
producer 以 non-empty typed limitation close 为 `partial`；interruption、Schema/storage failure 与 mailbox backpressure 不自动
冒充 partial。

适合逐条 plain-data capture 的 source 使用 `Record.attemptCollection()`、`records.append` / `appendAll(Stream)` 与显式
`records.close`。需要领域排序/去重、rich limitation、Content 或 reference closure 的 source 使用 `Record.attempt()` /
`Record.run()` 与一次 `records.write()`。同一 family 只有一个 capture authority。

## Content 与引用

Sandbox stdout/stderr 等大型 Content 由 builder mint logical handle。Host 在 transaction 外消费 source、计算 whole digest 与
byte length，再把 bounded chunks 交给 storage worker。读取时 `byteLength` 不加载 bytes，`bytes/text` 先做 whole-value
admission，`stream` 才读取 chunk rows。

source navigation 用 durable `turnId`、`sourceItemId`、digest 与坐标连接 origin Run facts。reference 不授予 Content capability，
也不复制 origin Attachment。Attempt、Run、family 与 logical identity 必须由 generic Seal inventory 穷尽验证。

## Reader-side views

| view | dependencies |
|---|---|
| conversation | agent turns + turn contexts |
| usage | agent turns |
| commands | sandbox commands |
| timing | runner activities |
| diagnostics | runner diagnostics |

projector 对每项 dependency 分别保留 `complete`、`partial`、`not-recorded`、`invalid` 或 missing definition；它不能用另一个
source 替代损坏事实。total token、cost、duration coverage、grouping 与 trace tree 属于固定 Inspection Operations。
一个 family 同时承载多个子通道时，每个 view 只让命中自己 target 的 limitation 决定完整度。
例如 conversation 的 unsupported item 不会把完整的 usage facts 投影成 partial。

大 collection 的 view 使用 `openCollection()` 流式投影；不得先调用 whole-value `read()` 取得完整数组再分页。每个 Stream
execution 持有自己的 storage-generation lease，physical-only migration 后可重开同一 `LogicalSealIdentity`，family migration
后必须 restart。
