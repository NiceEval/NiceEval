# RecordAttachment 作者 API —— Architecture

## 中立边界

`RecordAttachment` 的中立性由共同的语义内核保证，而不是由一把 owner-wide writer 保证：

```text
Eval author ─────────────┐
Experiment author ───────┤
linked Plugin occurrence ├─ exact write grant ─ owner context ─ record command
built-in producer ───────┘                                      │
                                                                ▼
                                                generic RecordAttachment writer
```

Plugin 不再拥有 `PluginAttachmentCapability`、Plugin writer、Plugin sink 或 Plugin 专用错误；内建子功能也不
直接提交 raw draft。每个入口只负责把自己的领域事实变成同一种 command，generic writer 仍只认识 owner、schema、
plain data、blob closure 与 durable publication。

## 四项互不蕴含的 authority

| Authority | 拥有什么 | 不拥有什么 |
|---|---|---|
| definition | owner、name、versions、current、blob projections、完整相邻 migration 图 | write grant、context lease、root、registry |
| application install | 当前 application 信任的 definition 集合 | producer 写权限、动态 package discovery、reuse policy |
| producer write grant | 一个 linked occurrence 可提交的 exact definition object 集合 | 其它 occurrence 的 allowlist、owner lease、migration trust |
| owner context lease | 当前 Run 或 Attempt 在 Open 期的实际 admission capability | 跨 owner、跨 session、maintenance migration |

四者使用同一个 opaque definition，但 authority 不沿引用自动传播。安装 definition 不允许任意 producer 写；producer
声明 write 也不会把 converter 安装进 CLI；拿到 definition 更不等于拿到当前 Run / Attempt 的 lease。

这些 boundary 是框架内的能力与生命周期纪律，不把同一 JavaScript application 变成 hostile-code sandbox。应用 import
并执行第三方 definition、Plugin 或 converter，即表示信任普通 JavaScript extension；真正不能泄露的官方 namespace
authority 与 writable official definitions 留在 package 内。

## 四种 identity

| 目的 | identity |
|---|---|
| write grant membership | exact definition object identity |
| link reservation、owner duplicate、application registry uniqueness | `(owner, name)` |
| durable schema | `(owner, name, vN)`，envelope 的 `schemaId` 为 `<name>/vN` |
| Plugin contribution provenance | exact linked occurrence identity |

复制 definition 的字段、伪造 brand 或重新调用同样的 definition input，不会进入某个 occurrence 的 exact-object grant。
反过来，两个不同 definition object 只要使用同一个 `(owner, name)`，在同一 link 或 registry 内仍是冲突，不能靠对象
identity 绕过 durable family 唯一性。

schema identity 只冻结已保存 payload 与 closure 的语义。产生 payload 的算法仍属于 Eval、Experiment、Plugin 或内建
producer 的 behavior identity；是否要求 current Attachment 才能 carry 由独立 reuse requirement 声明。definition
不把这三种 identity 合并。

## Definition compiler

公共 `defineRecordAttachment()` 一次编译整个 family：

```text
author input
  → exact owner/name validation
  → continuous v1 … vN validation
  → current = maximum version
  → schema + exhaustive blobRefs per version
  → exactly one adjacent edge per non-current version
  → opaque family definition
```

TypeScript 通过 keyed `versions`、typed version tokens 与 contextual migration targets 尽量让 missing edge、extra edge、
wrong target 和 wrong payload 不可表达。runtime 不假定版本只有个位数；它按数值读取任意十进制 `vN`，因此 `v1`、`v2`、
`v10` 与 dynamic JavaScript 都接受同一套连续性、最大 current、缺边、额外边、跳边、倒序、分叉和重复 identity 校验。

高层 definition 是 one-shot `defineX` API。非法 dynamic input 同步抛出稳定的
`RecordAttachmentDefinitionError`；不会返回一个稍后才在首次 writer 或 migrate 中失败的半成品。公共包不导出可拆开
拼装单版本 definition、edge、family 或 write 的底层 constructors。

第三方 `name` 必须是 reverse-domain lowercase ASCII namespace，公开 constructor 拒绝 `niceeval.*`。package-private
compiler 入口只多持有一个 namespace authority；编译完成后的官方 definition 不获得第二套 schema、writer 或 migration
语义。

## 不可变 plain-data snapshot

`Schema.Schema.AnyNoContext` 只能说明 schema 不需要 Effect context，不足以证明 decoded value 可安全冻结。例如
`Object.freeze(new Date())` 仍可能通过内部 slot 改变可观察值。因此每个写入、reader materialization 与 migration target
都要经过 package 的 plain-data guard：

```text
null | boolean | finite number | string
readonly array<PlainData>
plain record<string, PlainData>
package-minted RecordBlobRef
```

`undefined`、non-finite number、function、symbol、`Date`、`Map`、`Set`、typed array、class instance 与任意自定义
prototype 都被拒绝。时间、BigInt 或其它领域值先由作者 schema 编码为有明确语义的 ISO / decimal string 等 plain
representation。

`record()` 不冻结或改写作者对象。admission 在返回 Promise 前执行：

```text
schema encode author input
  → package-owned encoded clone
  → exact decode
  → plain-data guard
  → deep-freeze package snapshot
```

package-minted `RecordBlobRef` 在 clone 中保留 capability identity；不能 stringify 后重建。`blobRefs` 只观察这份 frozen
snapshot。这样作者在 `record()` 返回后修改原对象，不会改变已登记 command、另一个 projector 或 migration 所见事实。

## Occurrence-local link

Eval author、Experiment author、每个 linked Plugin occurrence 和每个内建 producer 都形成独立 grant。一个 grant 只含
该 occurrence `recordAttachments.write` 中与 owner 相符的 exact definitions：

```text
Eval author occurrence       → Attempt grant A
Eval Plugin occurrence P1    → Attempt grant P1
Eval Plugin occurrence P2    → Attempt grant P2
Experiment author occurrence → Run grant E
framework built-ins          → package-private grants
```

这些 grant 共用 owner 的 lease、`(owner, name)` reservation table 与 generic sink，但任何 Plugin 都看不到 owner-wide
合并 allowlist。相同 `(owner, name)` 被两个 occurrence 声明时，link 在创建 Sandbox、Agent、Run 或 Attempt 资源前返回
带双方 provenance 的冲突。runtime 的 generic duplicate guard 仍保留，防守 dynamic JS 和 broken invariant。

## 唯一写入数据流

```text
ctx.record(definition, payload | blobBuilder)
  → lease / owner / exact-grant admission
  → atomically reserve (owner, name)
  → capture package-owned payload snapshot
  → register tracked Effect command
  → validate blob closure and consume Streams
  → generic draft.record(opaque write)
  → flush attachment
  → emit accepted event
```

作者看到的是 `Promise<void>`，canonical command 则是 Effect 3 的 Effect-native operation。Promise facade 把同一 command
提交给 owner 已持有的 Effect Scope bridge，并观察同一个 completion；每次 `record()` 不创建嵌套
`Effect.runPromise()`、第二个 runtime 或 detached fiber。内建 producer 通过 Effect adapter 进入同一 admission、grant、
reservation、poison、sink 与 accepted-event 语义。

直接 payload overload 只允许 `blobRefs(snapshot)` 为空。blob-backed overload 的 builder 只接受 opaque
`RecordBlobSource`（其 bytes 来自 Effect `Stream`），为本次 command mint refs，并把 refs 与 sources 封进 opaque write。
没有 raw path、blob key、raw JSON、native bytes 或手写 ref fallback。

accepted event 只在 generic writer 已经完整验证 schema / plain data / closure、消费并写完 blob、且 attachment write 成功后
产生。它携带 exact definition identity、owner/name/schema 与 linked occurrence identity；“调用过 record”或“已经 reserve”
不是 accepted contribution。

## Plugin provenance 也是普通官方写入

framework 在 external Plugin grants 关闭并 drain 后，从成功 accepted events 聚合
`niceeval.plugin-provenance`。随后它使用自己的 package-private definition、显式 built-in write grant 与同一个 owner
context 写入 provenance，最后再关闭 framework grants。它不直接改 draft、不调用 Plugin sink，也不把失败 command 记成
成功 contribution。provenance Attachment 自己的 accepted event无需递归收进其 payload。

公共 API 只暴露官方 facts 的 projector / typed reader capability，不导出可写的 official definition。否则外部 producer
只要 import 官方 definition 再把它放入自己的 `write` 数组，就会伪造 NiceEval 事实权威。

## Sandbox、Agent、Adapter 与内建子功能

Sandbox 是资源 owner，Agent 是执行对象，Adapter 是外部协议 receiver；三者都不是 durable Record owner。它们默认只
返回 typed observation、domain outcome 或 capture handle，由正在拥有 Run / Attempt 生命周期的 Eval、Experiment、
Plugin 或内建 producer 决定是否调用其窄 `ctx.record()`。只有某项 hook 已明确属于单一 owner occurrence 时，才可传入
该 occurrence 原有的窄 context；不能向 provider 或通用 adapter 注入 raw Record capability。

Assertions、Verdict、Score、Eligibility、Conversation、Commands、Usage、Timing、Diagnostics 与 Sources 各自由领域
adapter 负责联合不变量。Sandbox facts 与 Plugin provenance 也遵守这条边界。

adapter 验证完成后，经 package-private official definition 和显式内部 grant 提交 generic write。generic writer
不认识这些领域名字。这样领域 contract 可以各自演进，同时没有“官方 bypass”或 Plugin 特殊写入面。

## 读取与投影

application registry 安装完整 definition，普通 reader 再用其 current family exact-match owner/name/schema：

```text
installed definition + frozen Record view
  → read owner/name
  → exact envelope/payload/closure validation
  → plain-data frozen RecordAttachmentValue
  → optional neutral projector
```

普通 read 不执行 migration，也不扫描 Eval、Plugin 或 package。数据状态保持以下一一对应：

- missing 是 `unavailable`；
- known old 是 `migration-required`；
- unavailable edge 是 `migration-unavailable`；
- unknown schema 是 `unsupported`；
- invalid bytes 是 `invalid`。

I/O、permission、closed reader、defect 与 interruption 仍是 operation failure，不伪装成 data state。

projector 与 definition 分离。definition 只拥有 durable schema 和 migration；一个或多个 projector 可以把同一
`available` value 解释成不同 typed view，但不能借此改变 write grant、behavior identity 或 reuse requirement。官方
projector同样消费中立 reader value，不取得 writable official definition。

## Migration 数据流

```text
config installs whole definition
  → registry validates unique owner/name and complete graph
  → plan exact-matches stored owner/name/schemaId
  → maintenance lock + migration.in-progress
  → adjacent converter reads exact materialized source
  → target.value() | target.create() returns opaque write
  → maintenance committer reuses generic validators
  → sync target + remove/sync sentinel
```

family 独占自己的 schemas、相邻 converters 与 unavailable edges。registry 不接受外部 edge；CLI 也不从 Record bytes
推断 package 并 dynamic-import。converter 只能读取 `RecordAttachmentValue` 的 payload 与已 materialize blob closure，
并通过显式目标 token 的 `value()` / `create()` 形成下一版本。它没有 root、path、clock、network、当前 Agent、Eval、
Plugin 或 writer context。

converter 的 Effect requirement 是 `never`，表示它不依赖 NiceEval Effect service；这不阻止普通 JavaScript closure
读取 ambient Node state。因此 determinism 与不读取 clock/random/environment/network/filesystem 是 trusted author
contract，不宣称为 sandbox 或 double-run 证明。

converter 的 typed failure `ConvertE` 与 target blob source failure `BlobE` 保持分离。migration orchestration 在步骤
边界为它们补上 family 与 edge identity；throw 保留 defect，fiber interruption 保留 Cause。

任一 failure、defect、interruption 或 durable write error 都留下 `migration.in-progress`。maintenance committer
可以有不同 lifecycle，但必须重用 schema、plain-data、closure、owner/name/schema validators。它不能成为 raw
JSON/path 的第二套 writer。
