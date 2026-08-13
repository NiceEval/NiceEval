# RecordAttachment adapter SPI —— Architecture

## 中立边界

Record 的中立性来自共同 adapter compiler 与 canonical command，不来自普通代码可见的万能 writer：

```text
Assertions sealed value ── official binding ─┐
Diff sealed value ──────── official binding ─┤
Timing sealed value ────── official binding ─┼─ RecordAttachment adapter
third-party sealed value ─ SDK binding ──────┘              │
                                                             ▼
                        admission → reservation → snapshot → closure
                                   → tracked command → poison → durable sink
```

所有 producer 先在自己的领域封口。generic kernel 只认识 exact owner、schema、plain data、blob closure 与 publication。
普通 Eval、Experiment、Plugin callback 与 `TestContext` 看不到 definition、grant、lease 或 command。

## 四项不能互相蕴含的 authority

| Authority | 拥有什么 | 不拥有什么 |
|---|---|---|
| adapter | owner、name、versions、current adaptation、projection、完整 migration graph | current owner、root、installation |
| installation | application 对 reader 与 converter 的信任 | binding、producer behavior、write lease |
| owner-specific binding | exact adapter、behavior identity、producer lifecycle | application migration trust、live writer |
| host-internal lease | actual owner 的 admission、tracked command 与 sink | SDK callback、跨 owner 或 maintenance authority |

adapter 返回 installation 与 projector，但两者是独立 opaque facets。installation 不能构造 binding；projector 不能反推
adapter；binding 也不能取得 application registry。

内部 grant 与 lease 只由 host 从 linked binding 推导。它们仍提供 least authority，但不成为公共作者 API。

## identity

| 目的 | identity |
|---|---|
| adapter／binding membership | exact adapter object identity |
| link reservation 与 registry uniqueness | `(owner, name)` |
| durable schema | `(owner, name, vN)` |
| producer behavior | binding 的 canonical behavior identity |
| Plugin provenance | exact Run 或 pair／Attempt occurrence identity |

结构相同的 adapter object 不能冒充 exact binding identity。两个 object 只要 `(owner, name)` 相同，在同一 registry 或
owner link 内仍冲突。schema identity 只解释持久 payload；它不能替代 meter、collector、evaluator 或其它 producer
algorithm 的 behavior identity。

## adapter compiler

`defineRecordAttachmentAdapter()` 一次完成：

```text
owner/name validation
  → continuous v1 … vN
  → current is maximum
  → schema + exhaustive blobRefs for every version
  → one adjacent edge for every non-current version
  → sealed-value adaptation + current projection
  → opaque adapter / installation / projector facets
```

TypeScript 让 literal input 的 missing edge、wrong target 与 wrong payload 尽量不可表达。runtime compiler 对 dynamic
JavaScript 执行相同检查。非法 definition 同步形成一个 bounded `RecordAttachmentAdapterDefinitionError`，不会留下到
首次 write 或 migration 才失败的半成品。

第三方 name 必须是 reverse-domain lowercase ASCII namespace。`niceeval.*` 只由 package-private namespace token
放行；token 不开放第二套 adapter、writer 或 migration 行为。

## adapter 是纯边界

`adapt(sealedValue, target)` 只把已经封口的领域值变成 current target write。它不采集、计时、查询设备、打开资源或
选择 owner。`project(availableValue)` 只把 current Attachment 解释为领域 view。二者把版本化 storage shape 限制在
SDK 内，事实生产者和消费者不构造 versioned document。

所有 adaptation、reader materialization 与 migration target 共用相同 snapshot：

```text
Schema encode
  → package-owned clone
  → exact decode
  → plain-data guard
  → deep freeze
  → blob closure validation
```

SDK mutation 输入不会改变已经接受的 command。只有 package-minted blob ref 能跨 clone 保留 opaque identity。

## owner-specific link

binding declaration 住在具体 owner fragment：

```text
Eval Plugin fragment.recordAdapters.attempt
  → pair/Attempt occurrence

Experiment Plugin fragment.recordAdapters.attempt
  → pair/Attempt occurrence

Experiment Plugin fragment.recordAdapters.run
  → Run occurrence
```

Experiment mount 可以共享 Plugin name、instance 与 source provenance，但 Run 与 pair／Attempt 是两个独立 occurrence。
它们有不同 grants、behavior identity、open／closed state、accepted events 与 seal barrier。Group 没有 owner。

link 在任何 Sandbox、Agent、Run 或 Attempt 资源前检查：

- genuine adapter 与 owner-specific binding；
- `(owner, name)` 在目标 owner plan 中唯一；
- behavior identity 可规范化并进入正确 fingerprint；
- binding 只出现在允许该 owner 的 fragment；
- installation registry 的 `(owner, name)` 也唯一。

link 冲突是零资源 failure。application 安装相同 family 不参与 producer duplicate 检查，也不自动挂载 binding。

## total producer obligation

binding 不是写入机会。actual owner open 时，host 立即 reserve family、登记 pending tracked producer，并为其创建 child
Scope。该义务只能收束为：

```text
one sealed domain value
  → release succeeds
  → pure adaptation
  → one canonical command accepted

or

owner lifecycle failure
```

正常 empty、partial 与 unavailable 由领域值表达。callback 没运行、返回零值、重复 producer、release failure 或 command
failure 都不能靠 Attachment 缺席继续发布。

carry／reuse 不打开 binding。历史事实的 presence、current version 与 producer behavior 是否适合复用，由独立 reuse
contract 判断。

## canonical command

binding 成功封口并释放资源后，host 内部提交唯一 command：

```text
exact adapter + sealed domain value + internal owner lease
  → exact-grant admission
  → existing owner/name reservation
  → adapter current target
  → immutable payload snapshot
  → blob closure validation
  → tracked Effect command
  → generic draft write
  → flush
  → accepted event
```

accepted event 只在完整 durable write 成功后产生。reserve、open、seal、adaptation 开始或局部 blob write 都不是 accepted
contribution。内部 command 可以命名为 `submitRecordAttachmentCommand`；它不是公共 facade，也不从 context 暴露。

failure、defect 与 interruption 都 poison owner。SDK 无法 catch 一个 Promise 后撤销 poison，因为 SPI 没有公共 Promise
writer。host drain 同一个 tracked command set，不存在 detached runtime。

## Plugin provenance

Plugin provenance 只汇总成功 accepted events与其它已接受 contribution refs。每条 event 带 exact adapter、owner/name/
schema、behavior identity 与 linked occurrence provenance；不带 raw path、blob ref、payload 或 secret。

framework provenance 自身也是 official adapter binding 的 total obligation。它不直接写 draft，也不把自己的 accepted
event 递归收回当前 document。

## Sandbox、Agent 与领域 collector

Sandbox 是资源，Agent 是执行对象，Agent Adapter 是外部协议 receiver；它们都不是 durable Record owner。它们把 typed
observation 交给拥有生命周期的领域 producer。

需要多次事件的领域拥有自己的 occurrence-local collector。collector 可以接收多次 input，但只能在 owner Scope 内
seal 一次 domain value。RecordAttachment adapter 不提供 append、event log 或通用 `observe()`。

GPU、Timing 等 bracketed producer 的 live session 只住在 binding child Scope。它不进入 Plugin blueprint、module map、
`TestContext`、Record payload 或另一个 concurrent Attempt。

## 读取与 Analysis

application registry 安装 opaque installation 后，frozen view 用 adapter family exact-match owner/name/schema：

```text
installation + frozen Record view
  → exact envelope/payload/closure validation
  → available RecordAttachmentValue
  → SDK-owned projector
  → domain projected value
```

数据状态保持 `available | unavailable | migration-required | migration-unavailable | unsupported | invalid`。I/O、permission、
closed reader、defect 与 interruption仍是 operation failure。

SDK 的领域 Analysis API 必须保留 Sample denominator、每 slot 状态、issues 与 refs。它可以隐藏 adapter、reader、schema
和 payload，但不能把 unavailable 或 migration 问题压成 `undefined`。

## migration

```text
config installs opaque installation
  → registry validates adapter identity and complete graph
  → plan exact-matches stored owner/name/schema
  → explicit decision mints exact-plan authorization
  → exclusive maintenance lock + sentinel
  → adjacent converter + target
  → shared validators
  → durable commit
```

converter 只读取 exact materialized source 与自己的 blob closure，并通过下一版本 target 形成 opaque write。它没有 root、
clock、network、current Eval、Plugin、collector 或 writer context。普通 read、write、Analysis 与 Report 不运行 converter。

plan 与 authorization 都由同一个 maintenance facet mint。plan 绑定 exact runtime、source snapshot、installation identities
与 Git inspection；authorization 绑定 exact needed plan。结构相同的对象、另一 plan、另一 runtime 或下一进程都无效。

## official 与第三方

官方与第三方共同使用 adapter compiler、owner-specific binding、total obligation、Scope 与 current target。它们也共同
经过 validators、tracked command、poison、reader 与 migration orchestration。

authority 差异仅有：

- official constructor 持有 private namespace token；
- official adapter、binding 与 installation 不导出；
- official installation 由产品组合层固定提供，第三方 installation 由 application host 显式选择。

官方没有 parallel Effect facade、raw draft 或 schema bypass。若官方绕过 binding，机械中立性就不成立。
