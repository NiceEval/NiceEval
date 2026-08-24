# Record（持久事实集）：已封口运行与可组合 Attachment

Record（持久事实集）是 `<project>/.niceeval/record/` 中可携带、可复制并可进入 Git 的运行事实。
它保存已封口的 Run（运行）、Run 的导航关系，以及由 capture authority 产生的 RecordAttachment（附件）。
它不保存进程协调状态、缓存、Analysis（分析层）结果或 Report（报告）树。

Record 的边界分成三层：

- Record Core 提供 owner、目录、原子提交、content source 读取、digest、预算、Seal 与读取机制。
- `record/family` package 通过 `defineAttemptRecord` / `defineRunRecord` 定义新的 current logical fact。
  需要演进已有 family 时，底层 Attachment persistence SPI 继续拥有 durable revision 与私有相邻 migration。
- Runner、Sandbox、Adapter 与其它 producer 在亲历事实的边界 capture，只取得匹配 owner 的窄 `record.write` 能力。

对产品用户，Record 是 opaque directory（不透明目录）。用户可以整体复制它、把它放进 Git，并交给
`niceeval exp`、`show`、`view`、`clean` 与 `migrate`。普通 Eval、Analysis 与 Report 作者不读取内部布局。

current root 使用一次 beta cutover 后的新格式身份：

```json
{ "format": "niceeval.record.attachments", "recordId": "..." }
```

旧 `niceeval.record` 与 `niceeval.record.source-receipts` 都是 legacy root format。ordinary reader 不加载
legacy decoder，也不把 legacy bytes 猜成 current。decoder 只在显式 migration 中可用。

```text
Record
├─ root Core JSON
└─ Run
   ├─ Core JSON（Run、Slot、Member 与 Attempt）
   ├─ Attachment
   │  ├─ attachment.json（唯一 Attachment commit record）
   │  ├─ payload/sha256/<digest>
   │  └─ content/sha256/<digest>（本 Attachment 私有的 content-addressed namespace）
   ├─ Seal manifest（完整 Run inventory）
   └─ complete
```

`complete` 与 Seal manifest 在 sealed local staging 中形成，再通过 no-replace directory rename 同步发布。
缺少任一发布文件、形态错误或 Core publication identity 不合法的 Run 不是可读事实。
普通 reader 不扫描 staging；writer residue 只留给 maintenance 检查。

Record Core 只保存完整 `attemptId`。面向人的 locator 是确定性别名：`@1` 加
`SHA-256(AttemptId UTF-8)` 前 60 bit 的 12 位大写 Crockford 编码。短码碰撞时读取返回 `ambiguous`。

每份 `run.json` 都有必填的 `RunDocument.context`：
`{ experimentId, execution: { agentId, model, reasoningEffort, flags }, labels }`。
它是随 Run 一次写入的 Core 历史事实，不从当前配置回填。

## 作者 API 与底层 persistence

`defineAttemptRecord` / `defineRunRecord` 是新 family 的规范作者入口。每次调用返回同一个 callable nominal
definition `a`：它既用 `a(value)` / `a(builderCallback)` 构造惰性 write command，也是 reader selector、
reference target 和 Host `RecordContribution`。完整调用形状、write/append case 矩阵与 Seal 语义见
[Record Library](library.md)。

每个 definition 只描述一个 owner kind 下的 current logical fact：

```text
(ownerKind, family, current Schema, named validate)
```

`family` 是不含版本的稳定身份。definition 带 owner nominal brand。
Run writer 不能使用 Attempt definition，Attempt writer 不能使用 Run definition。高层 definition 自动创建 revision `1`。

第三方 definition 是纯值，不能打开 Record root、构造路径或取得文件系统能力。Host 或 Plugin composition 通过
`makeRecordHost({ records })` 显式贡献它，owner-scoped writer 才能执行 `record.write(a(...))`。

`defineRecordAttachment`、`defineRecordAttachmentPersistence` 与 `defineRecordMigration` 保留为底层 SPI。
它们只负责已有 family 的演进和迁移。persistence 必须经
`recordContributionFromAttachmentPersistence(...)` 才进入 `{ records }` composition。
这层技术契约仍由 [Record Library](library.md#low-level-attachment-persistence-spi) 与
[Record Architecture](architecture.md#底层-attachment-persistence-spi) 负责，高层不承诺 revise API。

composition 为每个 read、write 或 migration session 建立 immutable catalog。catalog 不是进程全局 registry，
没有模块加载副作用、动态注册或后写替换。重复 definition brand、revision 分叉与缺少相邻 migration 在 session 取得 I/O
能力前失败。

官方 family 包括 Assertions、Agent Turns、Turn Contexts、Sandbox Commands、Runner Activities、Runner
Diagnostics、File Changes、Sources 与 Artifacts。它们不是 Core 特权；每个 `definition.ts` 只组装所属业务模块的
current Schema、named validate、内容值约束与 migration-private parser。Core 另有不因 family 放宽的全局安全预算。

## 局部读取与完整性

reader 只按调用方传入的 session-local catalog 解码 current definition。未知 family 不再让无关读取整体失败：

| 场景 | 结果 |
|---|---|
| 请求的 owner 没有该已知 family | `not-recorded` |
| 已知 current Attachment 通过 schema、invariant 与 content closure | `available` |
| 已知 current Attachment 的 bytes、reference 或 content 不合法 | 该 Attachment 为 `invalid` |
| inventory 含未贡献的 family，但当前读取不依赖它 | 继续读取无关 family |
| 直接请求或 reference closure 需要未贡献的 identity | `family-definition-required` |
| 已知 family 的已保存版本不是 current | `migration-required` |
| 调用 `requireComplete()`、发布 Run 或验证完整 Seal 时缺 definition | fail closed，不形成完整结果 |

未知 family 的 bytes 只是尚未解释的 inventory，不能被当作 valid、invalid 或 `not-recorded`。
局部读取只证明请求 definition 的 closure；`requireComplete()` 才证明整份选择所需的所有 Attachment。

Observability source 可以各自为 `complete` 或 `partial`。未写该 source 是 `not-recorded`，已写但不合法是
`invalid`。成功观察零项必须 write 该 family 的 complete-empty value；`partial` 必须显式携带 limitation。逐条事件
只在单一领域 collector 内 append、排序和去重，再一次 write 完整有界 value。conversation、usage、commands、
timing 与 diagnostics 是 reader-side view，不是 durable family。

## Content 与 reference

capture input 中的 content source 可以来自 bytes、text 或有界 Stream。session callback 为它 mint owner-local
token；logical Attachment value 不含物理存储分支、path、digest 或 blob key。

Record Core 统一读取 source、计算 digest 和 byte length、执行 current Schema 的内容值约束与全局安全预算，并写入私有物理表示。
每个 Attachment 拥有自己的 content-addressed namespace；相同 digest 也不能跨 Attachment 去重或引用。

Core-owned sealed content/reference Schema declaration 表达 owner / family 之间的业务依赖，并由 compiler 生成 traversal 与 closure plan。reference 不授予 content capability。读取 dependency closure 时缺少目标 persistence 会返回
`family-definition-required`，不会按字符串或目录猜测 target。

## 显式 migration

ordinary reader 只读 current persistence revision，绝不改盘。读到同 family 的 predecessor 或其它已保存版本时返回
`migration-required`，并要求用户显式运行 Host maintenance 或 `niceeval migrate`。

每个 persistence 只能声明严格相邻、无分叉的单链 migration。`planMigrate()` / `applyMigrate()` 在 exclusive
maintenance session 中按 canonical owner / family 顺序执行。migration 只消费 storage-neutral tokenized document；family-private parser 证明旧业务 closure，Core 只证明通用 physical/token closure。它不能读取当前 worktree、网络、时钟、随机源或 provider。

相邻 revision 只在内存流转；只有 current revision 的完整结果才写入 Attachment 私有 namespace，并以原子替换
`attachment.json` 提交。envelope 仍是 Core 私有 wire shape，包含 payload/content pointers。崩溃前未被 envelope 引用的 content 是 orphan；全部 Attachment current 后才重建 Seal manifest。plan/receipt 列出 retained、dropped 与 rerun impact。

Record 不调用 Git preflight，也不写 migration sentinel、journal、backup 或 rollback metadata。Git 只为用户提供
历史、diff、restore 与 rollback。迁移本身依靠 envelope commit、content address 与确定性扫描幂等续跑。

## Staging、发布与残留删除

writer 在 portable Record 外、同一文件系统的 local staging 中形成整个 Run。它验证 Core、每个已贡献
persistence、reference closure、内容值约束与完整 Seal，随后用 no-replace directory rename 发布。

发布后的 Run 除显式 migration 外保持 immutable。`clean` 只在 exclusive maintenance 下删除重验后仍未发布的
incomplete Run。migration 在重建完整 current Seal 后才删除可证明未被 envelope 引用的 content orphan。
ordinary read 不执行维护，也不删除 bytes。

## 从 Record 到闭合输出

Analysis Host 用 reader 与 selection 建立 Sample（样本）。某个 `AnalysisInput` 或 `DomainView` 请求事实时，
Sample 才在自己的 Scope 内读取对应 definition 与 dependency closure。Report 只消费闭合结果，不取得 reader、
Attachment、content handle、Scope、路径或未解释 payload。

```text
AnalysisInput / DomainView
             │ request definition
             ▼
Sample lazy cache ──▶ Record reader ──▶ validated Attachment closure
             │
             ▼
ClosedRows / SemanticFrame / DomainView
             │
             ▼
Report
```

## 入口

- [Library](library.md) —— 最小公开 SPI、session-local catalog、reader、owner writer 与 typed failures。
- [Architecture](architecture.md) —— durable layout、信任边界、预算、发布、崩溃状态与显式 migration。
- [Observability Source receipts](architecture/observability-attachments.md) —— 五个官方 source family 与 reader-side view。
- [CLI](cli.md) —— `show`、`view`、`exp`、`clean` 与显式 `migrate` 的反馈。
- [Use cases](use-case/README.md) —— 第三方 Attachment、完整 Run、源码闭包与可续跑 migration。
