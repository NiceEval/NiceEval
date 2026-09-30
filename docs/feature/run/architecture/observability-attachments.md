# Run Observability Source receipts

Observability 的 durable facts 按 capture authority 分 family。Adapter、SessionManager、Sandbox wrapper 与 Runner 只能保存
自己亲历且有权解释的事实。conversation、usage、commands、timing 与 diagnostics 是 reader-side view，
不是另一组 durable table 或 aggregate family。

## 官方 families

| family | owner | capture authority | Content |
|---|---|---|---|
| `niceeval.execution-traces` | Attempt | Adapter 已封存事件快照 | 同 owner 附件中的精确 JSON 证据 |
| `niceeval.adapter-usage` | Attempt | Adapter 最终调用快照 | none |
| `niceeval.agent-turns` | Attempt | Adapter terminal Turn | none |
| `niceeval.turn-contexts` | Attempt | SessionManager physical `t.send` context | none |
| `niceeval.sandbox-commands` | Attempt | Sandbox command lifecycle | stdout / stderr |
| `niceeval.runner-activities` | Attempt or Run | owner-local monotonic clock | none |
| `niceeval.runner-diagnostics` | Attempt or Run | Runner diagnostic sink | none |

这些 family 与第三方 family 使用相同 generic `attachments`、`collection_items`、`contents`、`content_chunks` 与
`attachment_references` rows。它们不拥有 table、index、transaction 或 SQLite connection，也不能要求 Host 按 family name
改变 physical schema。unknown family rows 可以留在内部存储中；只有需要解释该 family 的读取才要求 definition。

每个源码项（source item）都由稳定 identity 与内容摘要标识。

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
| execution | execution traces + 内建 agent turns 投影 |
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

## 通用事件 collection

`niceeval.execution-traces` 使用原生 collection items 保存快照头与事件，不把整局事件数组放入 Attachment header。
快照头拥有 `traceId`、schema、collection 和 scopes，事件拥有框架稳定身份与该 trace 内展示 ordinal。
导入时分配的身份在幂等重交、分页与 Record 搬迁后不变。字段全集由 [Adapter Library](../../adapters/library.md#保存通用执行轨迹) 拥有。

collector 先验证整份输入和同 Attempt 的附件证据，再接纳不可变值。publication 将 trace items 与附件内容一起关闭；
固定 family 的完整性校验核对 owner、附件 digest、JSON pointer、目标 digest 和长度。校验失败阻止 publication 或读取。
原生 collection 的 plain-data 限制不取消此闭合义务，未经校验的 artifactId 字符串不能替代验证。

读取按存储页扫描并控制内存，不宣称常数时间索引查询。每页响应受条数和 UTF-8 字节预算共同限制。
分页省略与采集 partial 分开；continuation 固定 origin Attempt、source、cutoff、revision、operation、behaviorVersion 和全部过滤条件。
任一条件变化要求重新开始，不能从另一个快照继续。旧 identityIndex 也必须有界且报告遗漏。

新 family 缺席为 not-recorded；内建 Agent 投影可以同时存在，但不能遮盖损坏的新 family。
兼容承诺是新 reader 读取当前支持格式的既有 Record，不要求旧 reader 接受新 family 或新的 Inspection 结果。
历史附件中的 trace JSON 不会被静默转换为执行轨迹，也不回写历史评分。

## 外部调用用量

`niceeval.adapter-usage` 的持久 revision 为 `2`，owner 为 origin Attempt。它保存最终快照，不保存可变的请求状态机。
同一 Attempt 的 `callId` 唯一；完全相同的规范化快照重报是幂等的，冲突拒绝并形成采集失败。
`retryOf` 只能引用此前登记的同 Attempt 调用，因此实际重试计作新请求。

```ts
interface AdapterUsageCall {
  callId: string;
  retryOf: string | null;
  provider: string | null;
  model: string | null;
  route: {
    transportProvider: string | null;
    endpointId: string | null;
  };
  status: "succeeded" | "failed" | "cancelled" | "unknown";
  inputTokens: number | null;
  inputTotalTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: null | {
    amount: CanonicalDecimal;
    currency: CurrencyCode;
    source: { kind: "reported"; id: string };
  };
}
interface PriceCharge {
  bucket: "input" | "output" | "cache-read" | "cache-write";
  tokens: number;
  ratePerMTok: CanonicalDecimal | null;
  amount: CanonicalDecimal;
}
interface PriceMissing {
  bucket: PriceCharge["bucket"];
  reason: "tokens-unknown" | "rate-unknown";
}
interface AdapterCallPriceReceipt {
  kind: "adapter-call-price-estimate";
  callId: string;
  state: "complete" | "partial";
  amount: CanonicalDecimal;
  currency: "USD";
  source: { kind: "estimated"; id: string };
  pricing: {
    basis: "catalog-reference";
    currency: "USD";
    source: {
      kind: "configured-profile";
      id: string;
      asOf: number | null;
      profileDigest: `sha256:${string}`;
    };
    requestModel: string;
    selector: string;
    match: "exact" | "provider-wildcard";
    ratesPerMTok: {
      input: CanonicalDecimal;
      output: CanonicalDecimal;
      cacheRead: CanonicalDecimal | null;
      cacheWrite: CanonicalDecimal | null;
    };
  };
  charges: readonly PriceCharge[];
  missing: readonly PriceMissing[];
}
interface AdapterUsageAttachment {
  collection: SourceCollection<{ code: "capture-failed"; stage: "adapter-usage" }>;
  calls: readonly AdapterUsageCall[];
  priceReceipts: readonly AdapterCallPriceReceipt[];
}
```

每项字符串最多 256 UTF-8 bytes，不能含控制字符；每个 Attempt 最多 4,000 个调用。
计数为非负安全整数或 `null`。`inputTokens` 排除 cache read/write；`inputTotalTokens` 是独立观察到的含缓存输入总量。
已知输入分项之和不能超过已知总量，全部分项已知时必须相等。总量不与分项相加，也不由分项补值。

没有 terminal 证据的最终快照使用 `unknown`。框架取消不证明上游取消；失败调用仍可有已知用量。
快照在外部工作排空后提交；`unknown` 不能再改成另一终态。provider/model 未知时保存 `null`，不猜供应商或 route。

`cost` 只保存一个上游 reported amount。明确的零仍是已知事实。market、gateway、surcharge 等其它金额不进入这个通用字段。
同一 `callId` 的完全相同快照保持幂等，任一字段冲突都使采集 sticky partial；不同调用之间不按回执 ID 猜测重复。

reported cost 存在时不生成 price receipt。reported 缺席时，只有显式 configured fixed profile 可以为该 call 生成 estimate receipt。
receipt 与同一附件中的 `callId` 一一关联；validator 核对 sealed token bucket、profile 对应 rate、逐桶金额、总额、state 与 profile digest。

cache rate 缺失时不回退 input rate。token 或 rate 缺失形成 partial proof；没有任何可证 charge 时不保存 receipt，effective cost 为 unknown。
内置 catalog 没有独立 flat applicability 证据时不用于该估算链。

collection 只证明已接纳快照的保存完整度，不证明所有外部请求都已被登记。
revision 1 由 reader 先按旧 schema 验证，再只读投影 `route` 与 `cost` 为 null、`priceReceipts` 为缺席。
它不改写旧附件，也不按当前配置补价格。旧 Record 缺少此 family 时保持 `not-recorded`，不合成空集合或改写旧 Agent Turn 事实。

`attempt.usage` 为每个调用投影 `effectiveCost`。reported 包括零并优先；缺席时才采用同 call 的 estimate receipt。
聚合按货币分组，`source` 为 `reported | estimated | mixed`，完整度单独表达。partial estimate 计入已知金额与 `estimatedCalls`，但不计入 `coveredCalls`。
总量在 128 条展示截断前计算，`totalCalls` 始终包含全部已登记去重调用。capture partial、unknown、历史 receipt 缺失及跨币种 USD 投影缺口向父级传播。
