---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Record（持久事实集）：已封口运行的固定事实

Record（持久事实集）是 `<project>/.niceeval/record/` 中可携带、可复制并可进入 Git 的运行事实。
它保存已封口的 Run（运行）、这些 Run 的导航关系，以及由 NiceEval 收集的 Attachment（附属事实）。
它不保存进程协调状态、缓存、Analysis（分析层）结果或 Report（报告）树。

对产品用户，Record 是 opaque directory（不透明目录）。用户可以整体复制它、把它放进 Git，并交给
`niceeval exp`、`show`、`view`、`clean` 与 `migrate`。普通 Eval、Analysis 与 Report 作者既不读取其内部
布局，也不定义或写入其中的事实。

`niceeval/record` 与 `niceeval/record/host` 都导出同一个 `recordHost`。它是公开、受支持的高级 Host
composition SDK，供 NiceEval CLI、替代 CLI / Web host 或深度应用集成组合 scoped Record I/O。它不让调用方
直接依赖目录布局，也不把 Record definition、family catalog 或 migration 变成可注册的 durable schema。

一个 source-first Record 的根只有稳定格式身份；数值版本只属于 Attachment：

```json
// record.json
{ "format": "niceeval.record.source-receipts", "recordId": "..." }

// runs/<RunId>/attempts/<AttemptId>/attachments/niceeval.assertions/attachment.json
{ "family": "niceeval.assertions", "schemaVersion": 1 }
```

`format`（格式身份）和 `family`（附件族身份）保持稳定；只有 Attachment envelope 的 `schemaVersion`
表达该 family 的 wire shape。`owner`（归属者）决定一份 Attachment 属于 Run 还是 Attempt。旧
`niceeval.record` aggregate layout 是独立 legacy format，不与 source-first bytes 混读。

```text
Record
├─ root Core JSON（核心身份 JSON；不含 blob）
└─ Run
   ├─ Core JSON（Run、Slot、Member 与 Attempt）
   ├─ Attachment
   │  ├─ payload JSON（可含本 Attachment 的 blob ref）
   │  └─ own blobs（只属于这一 owner 和 family）
   ├─ Seal manifest（Core、payload、segment 与 blob inventory）
   └─ complete
```

`complete` 与 Seal manifest 在 sealed local staging 中一起形成，再通过 no-replace directory rename 同步发布。
缺少任一发布文件、形态错误或 manifest / Core publication identity 不合法的 Run directory 不是可读事实。
manifest 声明的 source payload 或 blob 损坏只使该 source `invalid`。普通 reader 不扫描 staging；writer residue
与 recovery state 只留给 maintenance 检查，不进入 Analysis 或 Report warning。

Record Core（核心身份）只保存完整 `attemptId`。面向人的 locator 是上层确定性别名：`@1` 加
`SHA-256(AttemptId UTF-8)` 前 60 bit 的 12 位大写 Crockford 编码。它不写入 Core，也不触发迁移。
同一短码命中两个 immutable Attempt 时，读取返回 ambiguous，绝不任选。

Record 不保存 session、锁或 cache。它也不保存作者 API、matcher、执行顺序、沿用算法、分析算法或
页面模型。判定、计分与准入属于 Assertion、Attempt outcome 或 Analysis，不进入 durable catalog。

每份 `run.json` 都有必填的 `RunDocument.context`。它是随已封口 Run 一次写入的 Core 历史事实：
`{ experimentId, execution: { agentId, model, reasoningEffort, flags }, labels }`。其中
`context.experimentId` 必须与 Run 的顶层 `experimentId` 相同；它让离线读取能解释实际 agent、model、
reasoning effort、声明 flags 与 labels，而不会读取今天的配置。

## 固定定义与 current catalog

NiceEval 的 package-private（包私有）Record 作者模型只使用
`defineRecordCore` 与 `defineRecordAttachment`。两者驱动 Core 与 Attachment 的编解码、读写和校验，
不是应用、Adapter、Plugin 或第三方的 API。

`defineRecordCore({ schema, limits })` 接收一个 Effect Schema。`Schema.Type` 定义内存字段，
`Schema.Encoded` 定义 durable JSON 字段。字段名和 durable JSON 键不同时，Schema 在字段处使用
`Schema.propertySignature(...).pipe(Schema.fromKey(...))` 声明该映射。`AnalysisInput.id` 仍是分析投影身份，
与 Record 的 durable JSON 键无关。

`defineRecordAttachment` 把 stable `family` 与 `current` 分开。`current` 包含 `schemaVersion` 和所有 owner；
每个 owner 相邻声明 `schema`、`limits` 及 `blobs: { refs, budget, verify }`。可选 `maintenance` 是 async 的 lazy
历史 codec 与相邻 migration 描述。

NiceEval current 固定 Attachment catalog 如下。一个 family 只有一个定义入口；多个 owner 写在同一
`owners` map，不复制 family 或另立版本名称。

| family | current | `owners` | 保存的事实 |
|---|---:|---|---|
| `niceeval.assertions` | 3 | `{ attempt }` | criterion、materials、evaluation、decision、policy、contribution 与有界 explanation retention |
| `niceeval.agent-turns` | 2 | `{ attempt }` | Adapter 解释后的 observed event、terminal Turn 与 provider usage observation |
| `niceeval.turn-contexts` | 1 | `{ attempt }` | SessionManager 在每个物理 `t.send` 保存的 source context |
| `niceeval.sandbox-commands` | 1 | `{ attempt }` | Sandbox wrapper 保存的 command lifecycle 与 stream |
| `niceeval.runner-activities` | 1 | `{ attempt, run }` | Runner owner-monotonic clock 上的 activity |
| `niceeval.runner-diagnostics` | 1 | `{ attempt, run }` | Runner diagnostic sink 的 advisory 与 execution error |
| `niceeval.file-changes` | 1 | `{ attempt }` | 归因策略、采集状态与按 send 区间排序的文件变化轨迹 |
| `niceeval.sources` | 1 | `{ run }` | 当时源码闭包的 manifest 与 own blob |
| `niceeval.artifacts` | 1 | `{ attempt, run }` | 有媒体类型、身份和 own blob 的大型文件 |

每个 family 目录的 `definition.ts` 放置唯一的 declaration、复杂 payload Schema、durable JSON 键、limits 与
blob closure / integrity。

每个历史相邻迁移位于 `migrate/<from>-to-<to>.ts`。它与自己的 decoder、transform 和 retention 相邻。
总 catalog 只列 declaration，不重新描述任何 payload。

Adapter 与 collector 只能提交 NiceEval 提供的固定输入。没有调用方可用的 generic definition、family、
registration point 或 migration registration。此前未保存且不可恢复的事实必须经过 NiceEval 裁决，
要么扩展既有 family，要么由 NiceEval 增加新的 fixed family definition。它不能成为调用方定义的第三方
durable family。

ordinary reader 和 writer 接受 exact root/Core 与 current catalog。未知 family、known family 的 future 版本和
不相容 Core 都在 Analysis、Report 或 Runner 形成前 fail closed。Attachment 的演进只提高所属 family 的版本，
不建立全局 writer/catalog epoch。

Core 的 `Schema.Encoded` 只允许 exact JSON，禁止 blob ref。Attachment owner 的 encoded side 仍是 exact JSON，
但可含由该 owner 的 declaration 唯一 mint 的 `RecordBlobRef`。一个 ref 只能指向同 owner、同 family 下的一份
own blob。完整 payload 与 closure 校验成功后才形成可用值。

## Source-first Observability

Observability durable facts 只按 capture authority 分成五个 family：Agent Turns、Turn Contexts、Sandbox
Commands、Runner Activities 与 Runner Diagnostics。每个 source 在自己的边界 normalize、redact、canonicalize
并保存 immutable receipt set；一个 capture authority 不能替另一个 capture authority 补写事实。

conversation、usage、commands、timing 与 diagnostics 是 reader-side view，不是 durable family。source navigation
是 Turn Contexts、Runner Activities 与 origin Run Sources 之间的 Fact relation，也不是 durable family。所有 join
只使用 `turnId`、`sourceItemId`、`sha256` 等 capture-time anchor，不根据数组顺序、文本或时间邻近度猜测。

每个 source 独立形成 `complete` 或 `partial` receipt set。Seal manifest 未声明该 source 时，reader 返回
`not-recorded`；已声明但 payload、segment identity 或 blob closure 不合法时，只对该 source 返回 `invalid`。
一个 source 的状态不污染其它 source。精确 payload、view dependency 与 legacy 规则见
[Observability Source receipts](architecture/observability-attachments.md)。

## File Changes：保留按 send 区间的轨迹

`niceeval.file-changes` 的 envelope 固定为
`{ family: "niceeval.file-changes", schemaVersion: 1 }`。它保存归因策略、采集状态和每个 send 区间的端点变化
轨迹，不保存文件级 `net`（净变化）、patch 或 hunk。`net` 只在 Analysis 能证明端点连续时形成。

例如，agent 在 `turn1` 创建 `src/answer.ts`，Eval 随后改过该文件，agent 又在 `turn2` 修改它。Attachment 保留两条
变化：`turn1` 的 `created` 和 `turn2` 的 `modified`。同一路径因此可在不同 send 区间重复出现；把它们合成一条
路径事实会把 Eval 的中间写入错误归给 agent。

完整采集也可以没有路径变化：send 区间仍按顺序存在，`changes` 可以为空。采集已开始后失败或中断时，Attachment
保留安全的已捕获前缀并标为 `partial`，不会把它伪装成空变化。只有采集器根本不适用时，这个 fixed family 才缺失并在
读取时成为 `not-recorded`。

## Staging、恢复与 Git-safe publish

writer 在 portable Record 之外、同一文件系统的 local staging 中形成整个 Run。seal 验证 Core、Seal manifest、
每个 payload 与 blob closure，逐文件和目录同步后，再用 no-replace directory rename 发布到 `runs/<RunId>/`。
发布不替换现有 path、不修改 Git index，也不会让 reader 看到半份 inventory。

local recovery manifest 绑定 staging、destination、`recordId`、`runId`、Seal manifest digest 与完整 portable
inventory。恢复只能重验 sealed staging 后重试同一发布，或确认 destination 已完整发布后收尾；它不能重跑
capture、拼接部分 payload 或从 blob 反推 manifest。whole-Record copy 与 Git 操作必须等待 writer 和 recovery 停稳。

## current 与 maintenance

内部 definition 有 `current`（当前）与 `maintenance`（维护）两个 facet（分面）。`current` 定义普通
reader、writer 和固定 family 必须接受的 root、Core 与 Attachment shape。`maintenance` 单独拥有 Attachment
检查、Git 预检和相邻 schemaVersion 迁移步骤。

普通 `RecordReadSession` 只读取 exact current format，绝不自动改盘。openRead 在一次有界候选枚举中逐 Run
观察同步发布的规范 `complete` 与 Seal manifest，冻结这组 RunId，并以同一集合完成 Core、portable inventory、
family 与 Attachment version gate。它只验证选择所需的 Core entry；source payload 与 blob closure 由 lazy read
验证，使损坏保持 source-local。之后的 selection、owner resolution 与 lazy reads 不重新扫描扩大集合。

Record root 的领域值没有 schemaVersion。未来不相容只由新的 `format` identity 表达。current
`niceeval.record.source-receipts` 要求 Core Seal manifest；旧 `niceeval.record` aggregate layout 在当前 beta
cutover 中明确 unsupported。Assertions 在 current format 内保留 package-private `1 → 2 → 3` chain，Agent Turns 保留 `1 → 2` step。兼容性如下：

| 碰到的 bytes | ordinary reader 的动作 |
|---|---|
| 已知 fixed family 是完整可自动迁移的 predecessor | ordinary 入口先退出检查 scope，再进入 Git-safe automatic maintenance；迁移成功后全新打开 current session |
| root format/Core 不相容，或 known family 是 future、unknown 或无完整 chain | `unsupported-format`，不形成 session |
| 未知 family | `unsupported-format`，不形成 session |
| current catalog 中缺少的 family | 在请求它时返回 `not-recorded` |
| 带 `/vN` 后缀的未发布 family 草案 | `unsupported-format`；它不能伪装为独立 future family |
| legacy `niceeval.observability` aggregate | `unsupported-format`；不拆成 source receipt，也不伪造 provenance |

ordinary reader 不局部容忍未知或 future bytes。maintenance 可以在已知 migration plan 中逐字保留不属于目标的
portable bytes，但全量 exact current 验证必须认识最终 inventory；否则迁移和普通打开都拒绝。

## 从 Record 到闭合输出

Analysis Host 用 reader 与 selection 建立 Sample（样本）。某个 `AnalysisInput`（分析输入）或
`DomainView`（领域视图）请求事实时，Sample 才在自己的 Scope 内惰性读取并缓存所需 Attachment。
缓存按精确 owner 与内部 fixed definition 区分，不能把一个 Attachment 的 blob 借给另一个 owner。

```text
AnalysisInput / DomainView
             │ request one fixed fact
             ▼
Sample lazy cache ──▶ package-private Record reader ──▶ validated Attachment
             │
             ▼
ClosedRows / SemanticFrame / DomainView
             │
             ▼
Report（只见闭合值；不见 reader 或 Attachment）
```

Report 可以呈现闭合结果，却不能取得 reader、Scope、Attachment、blob capability、路径或未解释的
Record payload。改变指标、页面或显示顺序不改变 Record。

## 入口

- [Library](library.md) —— 公开 Host composition SDK、惰性 reader、Run writer、错误与 maintenance API。
- [Architecture](architecture.md) —— definition、durable layout、Core、closure、发布与迁移不变量。
- [Observability Source receipts](architecture/observability-attachments.md) —— 五个 source family、Seal manifest、reader-side view 与 legacy 边界。
- [CLI](cli.md) —— `show`、`view`、`exp`、`clean` 与 `migrate` 的反馈。
- [Use cases](use-case/README.md) —— 并行追加、封口、源码闭包和 Git 恢复的完整路径。
