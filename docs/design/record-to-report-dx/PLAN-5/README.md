# PLAN-5：Physical packages → Projection → Relations

本计划固定一条当前候选尚未表达的边界：Record 按 physical fact package 保存；Sample 先从 Core 选择
population；单包解释属于 Projection；跨包 join 属于 Relations。Derivation 只在这些 relations 之上
计算指标，Report 只交付 closed results。

它不是第四种 Report 查询语法，也不改 Record Core。它挑战的是官方 `RecordAttachment` inventory：
durable package 不应按 conversation、usage、timing 等 Report 逻辑列预先拆分。

## 完整责任链

```text
Record Core + physical fact packages
                ↓
Sample：从 Core 选择 Runs、logical slots 与 exact owners
                ↓
Projection：一个 package → 一个或多个 typed local views
                ↓
Relations：按 Sample population 建立跨 package relations
                ↓
Derivation：可选的公式、aggregation、coverage 与局部失败
                ↓
Report：Page、PageFamily、Download 与 closed execution
```

这里共有五个必需 runtime 责任层：Record、Sample、Projection、Relations、Report。需要 managed
dependency、自动去重或 consumer-local failure 时再增加 Derivation，成为六层。Durable bytes 仍是 L0，
不参与计数。

## Physical package 怎样切

一个 package 的边界由下面五件事共同决定：

1. 同一个 epistemic authority 为同一个 Run 或 Attempt owner 形成。
2. 在同一个不可拆 seal transaction 中发布；任一部分失败时整包都不能成立。
3. 安全处理与 retention policy 相容；不相容时强制拆包。
4. 定义独立于当前 Report 的 bounded capture algebra、保留保证与 information-loss limitations。
5. 内部 entities 使用 producer-minted identities，并保存与其它 packages 建关系所需的 durable anchors。

“能独立演进”只指当前 durable compatibility contract：子集已拥有独立 schema generation、
collection completeness、retention receipt 或 lossless migration contract。它不指理论上某个
字段未来可以变化。未来出现新的独立 contract 时再拆新 package。

共享 schema/migration 是上述边界的结果，不是决定合包的循环理由。把 coordinator 提升为共同 writer 也
不能让多个事实权威自动变成一个 package。

“某个 Report 想单独显示一列”不是拆包理由。“OTel 是一个文件”在契约中的精确含义是“一份 OTel
physical fact package”：它仍由 `attachment.json`、payload 与零到多个 blobs 组成，不承诺一个普通
filesystem file。

## 候选物理 inventory

| owner | physical package | 事实权威与 seal 理由 | 保存什么，不保存什么 |
|---|---|---|---|
| Run | Run timing package | Run timing collector | Run owner-monotonic intervals |
| Run | Run diagnostics package | Run diagnostic collector | Run advisory 与 execution error |
| Run | Capture Receipt package | Run coordinator | Run representation profile 与 package expectations |
| Attempt | Agent events package | Adapter event collector | provider-neutral、安全化的 observed agent events 与 identities |
| Attempt | OTel package | OTel collector | 安全化的 OTLP/GenAI observation snapshot 与 span identities |
| Attempt | Attempt timing package | Attempt coordinator timing collector | 非 Adapter/OTel 的 Attempt lifecycle intervals |
| Attempt | Attempt diagnostics package | Attempt diagnostic collector | Attempt advisory 与 execution error |
| Attempt | Capture Receipt package | Attempt coordinator | representation profile 与每类 capture 的 expected state |

这是一套 provisional inventory，不表示原始 provider frames、hidden chain of thought、secret、任意 attributes
或未经安全化的 OTLP 可以落盘。安全化发生在 producer seal 前；Record 只接收已符合 package schema 的
facts。每个 package 仍是有明确语义的 schema；“physical”只描述 provenance、owner 与 seal transaction，
不表示 raw 或没有逻辑结构。

Run 与 Attempt 各有自己的 `Capture Receipt`。Receipt 声明 representation profile，并把每个 package
expectation 穷尽区分为 `sealed`、`unsupported` 或 `not-enabled`。`complete` / `partial` 只属于实际
package 自己的 collection；Receipt 不复制。没有 Receipt 的 missing 只留给 legacy/third-party/异常现场，
不能被解释成 complete-empty。

Inventory 的当前证明如下：Agent events、OTel、Attempt timing 与 Attempt diagnostics 分别由
不同 capture authority 声明自己的 completeness，任一失败都不应阻止其它包成立。Run timing 与
Run diagnostics 也可独立 partial、失败和演进，因此当即拆开。Capture Receipt 只由 coordinator
说明预期 capture profile，不拥有其它包的业务 facts。

PLAN-5 只挑战七个 Observability families 的组织方式。Commands、Sources、membership provenance、
Evaluation 和 diff 继续使用已有 owner-local packages、collection 和 migration 契约。Assertions、
assertion source-sites、Verdict、Score 与 Eligibility 也保持不变。它们可被 Relations 消费，
但不进入 Capture Receipt profile，也不被 PLAN-5 重写。

## 上层怎样形成语义

```ts
const observability = yield* sample.projectRepresentation(attemptObservabilityProjection);
const commands = yield* sample.projectPackage(packages.commands, commandViews());
const assertions = yield* sample.projectPackage(packages.assertions, assertionViews());
const verdict = yield* sample.projectPackage(packages.verdict, verdictViews());

const attempts = yield* sample.relations.build(attemptFactRelations(), {
  observability,
  commands,
  assertions,
  verdict,
});
```

Projection 可以从一个 package 形成多个 local typed views，但不能读取另一个 package。Relations 用显式
anchors 建 relation，例如 `spanId`、`operationId`、`sendId`、`commandId`、`assertionEntryId` 与 exact
Attempt ref。没有 anchor 时返回 unmatched/partial relation；不得按时间邻近、文本相等或数组位置猜测。

每种 cross-package anchor 只有一个 issuer：

- Attempt coordinator 在 `send` 前 mint `send` anchor，并通过 branded capture context 交给 Adapter 与
  OTel collector；
- command collector mint command anchor；
- Assertion collector mint assertion entry anchor；
- OTel collector mint 只属于 OTel package 的 span/operation local IDs。

其它 producer 只能保存传入 anchor，不能重建。Anchor scope 是 exact Attempt，并携带 kind 与 version。
这是有意的 capture-time coupling，但不会让不同 package 共用 bytes、schema 或 migration。

## 对当前七-family Observability 的挑战

当前 Feature 把 conversation、commands、usage、timing、diagnostics 等固定为独立 durable families。
这使单项读取和 owner-local migration 简单，却把逻辑消费列提前固化进 Record，并要求 producer 在 seal
前完成跨 family 联合验证。

PLAN-5 改为物理采集包后：

- conversation、usage、timing 可以是 Agent events 或 OTel package 的 projections，而非 durable tables；
- 同一 span 的 timing、usage 与 operation identity 不会被拆到多个 schemas 再重新拼回；
- Assertions、Verdict、Score 与 Commands 仍因 producer/lifecycle 不同而保持独立 packages；
- Report 只依赖公开 Projection/Relations，不获得原始 package reader 特权。

代价是只查询 usage 也可能读取整份 OTel closure。当前 reader 本来就完整 materialize 已请求 Attachment；
选择性 index、chunk 或 range read 必须由未来 Record reader/storage capability 解决，不能靠逻辑 family
切分假装已经解决。

### 多源 observations

Agent events 与 OTel 可以都观察同一次 request 的 usage/timing。各 package 保存 source-qualified
observations；共享 event anchor 只说明双方声称观察同一事件，不证明数值相等。Relations 穷尽返回
source-qualified candidate groups、structural state 与 coverage。

Calculation 或普通纯函数必须显式声明
reconciliation/authority policy，才形成 agreement、conflict、independent 或 partial。它不能静默 union、
优先 OTel 或替换另一个 producer observation。

### Candidate bounds

| package | payload | item cap | closure |
|---|---:|---:|---:|
| OTel | 2 MiB | 4,096 observations | 30 MiB；package 总计 32 MiB |
| Agent events | 2 MiB | 2,048 events | 8 MiB；package 总计 10 MiB |

单个 available package 的 encoded payload + closure 上限是 32 MiB。Projection scheduler 使用加权并发
budget，同时持有的 raw available snapshot leases 不超过 256 MiB。同步 projector 返回后
host 释放 scheduler lease 与它持有的 raw reference；这不承诺 GC 已回收内存，projected view 也不在
该 budget 内。

Projected views 与 Report model 仍受既有 entry-count limits，但没有可靠 heap byte bound。PLAN-5 不把
256 MiB 宣传成整个 execution 的 heap 上限。Producer 超限时保留已验证 facts 并写 partial limitation。
若真实 fixture 无法在这些 gate 下保留必需 facts，PLAN-5 在独立 reader/storage 设计完成前不合格。

## 历史数据与迁移

把七个旧 families 合并成一个新 package 不是 owner-local 单-family migration：它需要同时读取多份输入，
而现有 converter 明确不能这样做。PLAN-5 不为编译变绿而放宽 converter。

若采用本计划，只允许两条诚实路径：

- 新 Runs 由 Capture Receipt 原子选择 `physical-v1` representation；旧 Run 没有 receipt 时使用 legacy
  family projectors。一个 owner 不自动 union 两种 representation；
- 另立 cross-family maintenance migration 设计，显式定义原子性、失败恢复与 provenance，再决定是否
  重写历史 Record。

Record major 只有在 owner、Core refs、目录公理或完成判断变化时才需要；新增 package schema 本身不要求
Record major。

Receipt 声明 `physical-v1` 时它是 authoritative selection。Official writer 在发布前拒绝同 owner
双写 legacy/new；reader 不读未激活 legacy branch，因此也不声称在读时检出既存或第三方
双写。大 package 会放大单 schema migration 与验证的 blast radius；这是相对七-family 方案的明确代价。

## 入口

- [分层子设计](layer/README.md)：Sample、Projection、Relations、Derivation 与 Report 各自的责任、
  失败边界和验收条件。
- [Library](library.md)：package/projector/relation 的最小公开形状。
- [Architecture](architecture.md)：职责、不变量、failure 与演进边界。
- [Lifecycle](lifecycle.md)：capture、seal、Receipt、publish 与失败顺序。
- [OTel 与 Assertions](use-case/otel-and-assertions.md)：多物理包怎样进入同一 Attempt relation。
