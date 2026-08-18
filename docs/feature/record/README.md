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

一个最小 Record 使用稳定名称加数值版本，而不是把版本写进名称：

```json
// record.json
{ "format": "niceeval.record", "schemaVersion": 1 }

// runs/<RunId>/attempts/<AttemptId>/attachments/niceeval.assertions/attachment.json
{ "family": "niceeval.assertions", "schemaVersion": 1 }
```

`format`（格式身份）和 `family`（附件族身份）保持稳定；`schemaVersion`（数值 schema 版本）表达它们的
wire shape。`owner`（归属者）决定一份 Attachment 属于 Run 还是 Attempt。

```text
Record
├─ root Core JSON（核心身份 JSON；不含 blob）
└─ Run
   ├─ Core JSON（Run、Slot、Member 与 Attempt）
   └─ Attachment
      ├─ payload JSON（可含本 Attachment 的 blob ref）
      └─ own blobs（只属于这一 owner 和 family）
```

没有 `complete` 的 Run directory 不是 Record 事实。reader 不读取、不展示也不沿用它，只返回
`incomplete-run` warning；用户可以用 `niceeval clean` 删除。

Record Core（核心身份）只保存完整 `attemptId`。面向人的 locator 是上层确定性别名：`@1` 加
`SHA-256(AttemptId UTF-8)` 前 60 bit 的 12 位大写 Crockford 编码。它不写入 Core，也不触发迁移。
同一短码命中两个 immutable Attempt 时，读取返回 ambiguous，绝不任选。

Record 不保存 session、锁或 cache。它也不保存作者 API、matcher、执行顺序、沿用算法、分析算法或
页面模型。判定、计分与准入属于 Assertion、Attempt outcome 或 Analysis，不进入 durable catalog。

每份 `run.json` 都有必填的 `RunDocument.context`。它是随已封口 Run 一次写入的 Core 历史事实：
`{ experimentId, execution: { agentId, model, reasoningEffort, flags }, labels }`。其中
`context.experimentId` 必须与 Run 的顶层 `experimentId` 相同；它让离线读取能解释实际 agent、model、
reasoning effort、声明 flags 与 labels，而不会读取今天的配置。

## 固定定义与当前七个 family

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

NiceEval current 固定 Attachment catalog 有以下七个 family（附件族）。一个 family 只有一个定义入口；多个 owner
写在同一 `owners` map，不复制 family 或另立版本名称。

| family | `owners` | 保存的事实 |
|---|---|---|
| `niceeval.assertions` | `{ attempt }` | AssertionResult、Evidence 与已封口的检查结果 |
| `niceeval.observability` | `{ attempt, run }` | 对话、命令、用量、时间、诊断与 OTel 归一观察 |
| `niceeval.file-changes` | `{ attempt }` | 归因策略、采集状态与按 send 区间排序的文件变化轨迹 |
| `niceeval.source-navigation` | `{ attempt }` | 每个物理 `t.send` 的 turn、源码 frame 与 timing identity join |
| `niceeval.sources` | `{ run }` | 当时源码闭包的 manifest 与 own blob |
| `niceeval.artifacts` | `{ attempt, run }` | 有媒体类型、身份和 own blob 的大型文件 |
| `niceeval.experiment-presentation` | `{ run }` | 与 Experiment identity 分离的规范化展示名称 |

每个 family 的模块把自己的 declaration、复杂 payload Schema、durable JSON 键、limits 与 blob closure / integrity
相邻放置。总 catalog 只列这七个 declaration，不重新描述任何 payload。

Adapter 与 collector 只能提交 NiceEval 提供的固定输入。没有调用方可用的 generic definition、family、
registration point 或 migration registration。此前未保存且不可恢复的事实必须经过 NiceEval 裁决，
要么扩展既有 family，要么由 NiceEval 增加新的 fixed family definition。它不能成为调用方定义的第三方
durable family。

NiceEval 也可以在后续 catalog 中加入另一个固定 family，例如 `niceeval.energy`。这只增加该 family 自己的
definition、`owners` map 与 schemaVersion，不升级 Core。较早 reader 保留它在磁盘上的完整目录和 bytes，
忽略它并继续读取 Core 与认识的 family；只有请求 energy 的 AnalysisInput 或 DomainView 才得到
`unsupported`。

Core 的 `Schema.Encoded` 只允许 exact JSON，禁止 blob ref。Attachment owner 的 encoded side 仍是 exact JSON，
但可含由该 owner 的 declaration 唯一 mint 的 `RecordBlobRef`。一个 ref 只能指向同 owner、同 family 下的一份
own blob。完整 payload 与 closure 校验成功后才形成可用值。

## Source Navigation：每个物理 send 的无 blob join

`niceeval.source-navigation` 的 envelope 固定为
`{ family: "niceeval.source-navigation", schemaVersion: 1 }`。它是 Attempt-owned 的 package-private family。
它没有 blob closure，最多保存 256 行。每一行只保存 `turnId`、`sourceOrder | null`、一个 mapped 或 unmapped
source frame，以及 linked 或 unavailable timing。它不复制 Conversation outcome、duration、source text、path 或
blob ref。

Producer 在每个物理 `t.send` 的 Effect `Exit` 边界封口一个 ConversationTurn。成功、typed failure、defect
与 interruption 都产生不同 turn；多 session、多次 send 和同一源码行的重复 send 不合并。Navigation 按
ConversationTurn 的显式 `sequence` 保留同一行序，并以 `turnId` 一对一 join，不能按 payload 数组位置猜测关系。

mapped frame 必须以 exact origin Run Sources 的 `sourceItemId`、`sha256` 和坐标验证。unmapped 保留
`location-not-captured`、`source-snapshot-not-recorded` 或 `position-unrepresentable`。linked timing 只能引用
同一 Attempt Observability 中 phase 为 `agent.send` 的 `intervalId`；否则保留
`timing-not-recorded`，不补写 duration。

超过 256 行时，Conversation 与 Navigation 都保留相同的确定性物理 send 前缀。两者都标为 `partial`，并以
`collection-cap-reached` / `navigation-row` 的正 `omittedAtLeast` 说明至少遗漏的行。不可恢复的 timing capture
同样保留已有前缀，但以 `capture-unrecoverable` / `timing-link` 和正 `omittedAtLeast` 标记至少缺失的 timing link；
两个 target 使数量的边界明确且不可混淆。Host 不扫描 source、当前 worktree 或数组顺序来补全。

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

## current 与 maintenance

内部 definition 有 `current`（当前）与 `maintenance`（维护）两个 facet（分面）。`current` 定义普通
reader、writer 和固定 family 必须接受的 root、Core 与 Attachment shape。`maintenance` 单独拥有格式
检查、Git 预检和相邻 schemaVersion 迁移步骤。

普通 `RecordReadSession` 只读取 exact current format，绝不自动改盘。它先选择已封口 Run，形成只含
身份、预期 Slot 和问题的 `RecordSelection`。查询需要某条 trace、diff 或 Evidence 时，才读取并校验对应
Attachment。

Record 的首次正式格式是 schemaVersion `1`，没有已发布 predecessor（前代格式）。未来 schemaVersion 变化时，
maintenance 只执行固定的相邻步骤，例如 `1 → 2`。兼容性按对象判断：

| 碰到的 bytes | ordinary reader 的动作 |
|---|---|
| root 或 Core 的 schemaVersion 不匹配 | 若 maintenance 有相邻步骤，返回 `migration-required`；否则 `unsupported-format`，不形成 session |
| 已知 fixed family 的旧 schemaVersion | 返回 `migration-required`，普通读取不兼容，必须显式 migrate |
| 未知的独立 future family | 保留 bytes、忽略该 family，继续读取 Core 和认识的 family |
| current catalog 中缺少的 family | 在请求它时返回 `not-recorded` |
| 带 `/vN` 后缀的未发布 family 草案 | `unsupported-format`；它不能伪装为独立 future family |

未知 family 的局部容忍不让 reader 猜测 payload 或 blob closure，也不让 Report 看见原始内容。它只保护可读的
历史；依赖该 family 的能力保持 `unsupported`，直到使用认识该 definition 的 NiceEval。

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
- [Observability Attachment](architecture/observability-attachments.md) —— 单一 Observability family 的精确 payload。
- [CLI](cli.md) —— `show`、`view`、`exp`、`clean` 与 `migrate` 的反馈。
- [Use cases](use-case/README.md) —— 并行追加、封口、源码闭包和 Git 恢复的完整路径。
