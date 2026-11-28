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
Run-owned `niceeval.sources` 使用专用追加写入，普通 Attachment writer 的只写一次契约不变。
新增来源与完整 manifest 在 Attempt publication 前提交，已有 item 不改写。
同 path 同 sha256 去重；同 path 不同 sha256 的 item 同时保留，见 [source sites](../../assertions/architecture/source-sites.md)。

## 编码失败不吞掉 Attempt

producer 负责在写入前把亲历事实规范化到 family schema 之内：超长、含控制字符或不受支持的值按该 family 的规则截断、转义或记为 limitation，不能把原样数据交给 encoder 碰运气。

若某个 observability family 仍然编码失败，Attempt 照常发布：该 family 记为缺席（读取时为 `not-recorded`），另写一条 Attempt 级 `attachment-encode-failed` diagnostic，带 family 名与 schema issue 的路径和代码，不含原始值。Verdict 仍由 Assertions 决定；只有某条 Assertion 把该 family 当作 required 材料时，才按 [evidence](../../assertions/architecture/evidence.md) 规则成为 unavailable。

Invocation 继续结算其余 Attempt 并输出 receipt。一个 family 的编码失败不能让 `exp` 以 `runner-record-attempt-publication-failed` 中止，也不能让已完成的 Attempt 从公开 CLI 消失。

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
流式执行轨迹的截断不属于这种冒充：框架是流管道的 capture authority，只发布已验证前缀，并写入保留 code
`niceeval.trace-stream-cut` 说明缺口，见[流式接纳与暂存索引](#流式接纳与暂存索引)。

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
execution 持有自己的 storage-generation lease；generation 退休后必须 restart。
不跨格式重开或转换 collection，旧 Record 格式在 reader 建立前拒绝。

## 通用事件 collection

`niceeval.execution-traces` 使用原生 collection items 保存快照头与事件，不把整局事件数组放入 Attachment header。
快照头拥有 `traceId`、schema、collection 和 scopes，事件拥有框架稳定身份与该 trace 内展示 ordinal。
NiceEval 归一化的 OTLP trace 使用稳定名称 `niceeval.otlp`，持久格式由 Record 的唯一格式标记保护。
外部 emitter 提供的 schema identity 与真实版本属于原始事实，照常保存；标准 OTLP 接收协议保持不变。
导入时分配的身份在幂等重交、分页与 Record 搬迁后不变。字段全集由 [Adapter Library](../../adapters/library/README.md#保存通用执行轨迹) 拥有。

collector 先验证整份输入和同 Attempt 的附件证据，再接纳不可变值。publication 将 trace items 与附件内容一起关闭；
固定 family 的完整性校验核对 owner、附件 digest、JSON pointer、目标 digest 和长度。校验失败阻止 publication 或读取。
原生 collection 的 plain-data 限制不取消此闭合义务，未经校验的 artifactId 字符串不能替代验证。

outline 按存储页扫描并控制内存，每页响应受条数和 UTF-8 字节预算共同限制。
按 `eventId`、`traceId + key` 定位使用下文的身份索引，不扫描整条轨迹。
分页省略与采集 partial 分开；continuation 固定 origin Attempt、source、cutoff、revision、operation 和全部过滤条件。
任一条件变化要求重新开始，不能从另一个快照继续。旧 identityIndex 也必须有界且报告遗漏。

### 流式接纳与暂存索引

公开语义见 [Adapter Library](../../adapters/library/README.md#流式提交事件)。本节定义 Host 如何在有界内存中完成它。

每次流式调用在所属 Attempt 下取得一个暂存预留。预留身份由 `attemptId`、writer generation、`traceId` 与该 Attempt 内的提交序号组成。
同一 `traceId` 同时只有一个打开的预留。预留行与其它未发布 aggregate 一样受 [Run 架构](README.md#canonical-record-与运行中状态) 的 generation 与状态检查约束。

Host 按 encoded bytes 与条目数切批，批的上限由 Host 固定，作者不能选择。
每批在事务外冻结条目顺序、command identity、规范化 bytes 与 digest，再以一个短事务写入。
SQLite busy 或 ack 丢失只重提冻结批次，并按 [command 重试规则](storage.md#逻辑事实与物理行) 重读确认，不重新拉取迭代器。
producer 的等待始终在事务外。超过行内阈值的单个值先作为 Content 分块写入，批中只保存其 logical handle。

暂存索引按预留保存四类行：

- key 到接纳序号与稳定 `eventId` 的映射；
- scopeId 与每个事件的 evidence key，以及已分配的 `evidenceId`；
- 指向尚未出现目标的引用，记录引用方序号与目标；
- 条目、scope、事件与 evidence 的计数。

key 与 scopeId 唯一性、跨批引用的解析、计数与截断前缀都通过这些行计算，内存只保存当前批次与当前条目。
目标到达时删除对应的待解析引用。截断时最长有效前缀的终点是最早一条待解析引用的引用方序号，与流的终点二者取前。

流结束或截断后，Host 在有界批次中完成最终校验：待解析引用、`causes` 成环与 evidence 闭合。
`causes` 环检查按索引逐批做拓扑排序，不把整张图载入内存；截断时只校验有效前缀。
全部通过后，一个短事务把预留原子标为该 `traceId` 的接纳快照，并写入快照头：collection、计数与 `archive`。
截断时只有有效前缀成为快照，其后的暂存行随预留删除。任一校验失败则整体删除预留，此前接纳的快照不变。

同 `traceId` 已有接纳快照时，Host 在流结束后比较两份快照的规范化 digest。digest 对接纳顺序的条目流式计算，与提交方式无关。
相同则删除新预留并返回原快照的汇总，不同则删除新预留并按冲突拒绝。

接纳不推进 publication revision。暂存预留与接纳快照都只在 Attempt 发布后进入 Inspection。
Attempt 重试使用新的 `attemptId`，不继承预留；崩溃留下的预留随未发布 aggregate 由 [recovery](lifecycle.md#崩溃与-recovery) 清除。

### 身份索引

每个事件 item 携带通用 item key，值为 `traceId` 与事件 key 的规范编码，evidence 同样携带含 evidence key 的 item key。
Host 按 owner Attempt、family 与 item key 建唯一索引，按 `eventId` 与 `evidenceId` 建身份索引，不解释 item key 的业务含义。
Inspection 的 key 查询、`eventId` 详情与从指定事件开始的 outline 都经这些索引定位，读取成本与轨迹长度无关。

publication 与 hostile import 对 execution-traces 逐 item 核对 item key 与 item 内容一致且唯一，在有界批次中完成。
item key 是从事件派生的定位数据，不是第二份事实；不一致按 publication closure 失败处理。

### 读取兼容

新 family 缺席为 not-recorded；内建 Agent 投影可以同时存在，但不能遮盖损坏的新 family。
兼容承诺是新 reader 读取当前支持格式的既有 Record，不要求旧 reader 接受新 family 或新的 Inspection 结果。
历史附件中的 trace JSON 不会被静默转换为执行轨迹，也不回写历史评分。

## 观测生命周期与冷热分级

高并发批量评测时，内存占用与 I/O 成本由生命周期与冷热分级共同约束。

评测执行期间，`TestContext` 与内存链路追踪收集器的堆生命周期严格限定在 Attempt 内。
当 `test(t)` 函数执行完毕后，执行轨迹立即封存并移交给 dedicated storage worker 的内部 mailbox，
随后解除 `TestContext` 与闭包引用以供垃圾回收，避免海量样本长期滞留内存堆。

内存收集期同步维护核心角色指针索引。
当接收到 `llm`、`retriever`、`tool`、`chain` 核心角色 Span 时，收集器直接登记分类指针。
单参数上下文断言算子可直接按指针提取切片或模型事实，无需逐层遍历整棵 Span 树。

持久化按冷热数据进行物理切分。
执行轨迹的树形拓扑、耗时、状态、Token 与 Cost 摘要保存在主 collection item 行中作为热数据，
支撑大盘秒级聚合与瀑布图初次呈现。
大段检索切片文本、完整输入 Prompt 与模型原始输出作为 Content chunks 进入分块存储，
仅在用户下钻单条样本详情时按需流式提取，避免宽表读放大。

## 外部调用用量

`niceeval.adapter-usage` 使用当前 exact payload，owner 为 origin Attempt。它保存最终快照，不保存可变的请求状态机。
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

每项字符串不能含控制字符，长度不设上限；每个 Attempt 的调用数不设上限，每个调用是一个 collection item。
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
旧 Record 由存储格式标记拒绝，不为缺失字段补造 null 或估价事实。
它不改写旧附件，也不按当前配置补价格。旧 Record 缺少此 family 时保持 `not-recorded`，不合成空集合或改写旧 Agent Turn 事实。

`attempt.usage` 为每个调用投影 `effectiveCost`。reported 包括零并优先；缺席时才采用同 call 的 estimate receipt。
聚合按货币分组，`source` 为 `reported | estimated | mixed`，完整度单独表达。partial estimate 计入已知金额与 `estimatedCalls`，但不计入 `coveredCalls`。
总量在 128 条展示截断前计算，`totalCalls` 始终包含全部已登记去重调用。capture partial、unknown、历史 receipt 缺失及跨币种 USD 投影缺口向父级传播。
