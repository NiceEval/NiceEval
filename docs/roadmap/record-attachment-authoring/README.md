# RecordAttachment 作者 API

用户、Plugin 与 NiceEval 内建子功能都需要保存运行时才知道的事实。当前底层
`RecordAttachment` 已经统一磁盘格式、blob closure 与读取状态，但作者仍可能分别接触单版本
definition、family、write builder 或 Plugin 专用 capability。这样会把“怎样定义事实”“谁可以写”
和“哪个应用信任 migration”混成一件事。

本方向只提供一个高层入口 `defineRecordAttachment()`、一个作者动作 `ctx.record()` 和一个中立写入核。
简单 JSON 是零 blob 的调用形状，Plugin 与官方事实也不建立第二套持久 primitive。

## 核心心智

一个 definition 一次拥有完整版本族：

```text
defineRecordAttachment({ owner, name, versions, current, migrations })
  → opaque RecordAttachmentDefinition
```

definition 只定义事实，不自动授予任何其它权力。实际使用分成四项彼此独立的 authority：

```text
definition
  ├─ application install ───────────────→ 允许解释与显式迁移
  └─ producer write grant ──────────────→ 允许一个 linked occurrence 提交该 definition
                                               │
                                               ▼
                                   owner-local context lease
                                               │
                                               ▼
                                      generic attachment writer
```

| Authority | 公开声明 | 它不代表什么 |
|---|---|---|
| definition | `defineRecordAttachment(...)` | 没有 root、write lease 或安装状态 |
| application install | `recordAttachments: { install: [...] }` | 不允许任何 producer 写入 |
| producer write grant | `recordAttachments: { write: [...] }` | 不安装 reader / migration，也不跨 occurrence 共享 |
| context lease | 当前 `Attempt` 或 `Run` 的 `ctx.record()` | 不跨 owner、session 或封口边界 |

因此“中立”不是所有代码拿到同一把全局 writer，而是所有 producer 经同一种 definition、同一种
`record()` 语义和同一个 generic writer，同时每个 occurrence 只拿自己声明过的最小 authority。

## 谁怎样使用

- Eval 与 Eval Plugin 在各自 occurrence 的 Attempt context 写 Attempt-owned definition。
- Experiment 与 Experiment Plugin 在各自 occurrence 的 Run context 写 Run-owned definition。
- Sandbox、Agent 与 Adapter 不是 Record owner；它们把观测交回拥有生命周期的 producer，不取得 raw writer。
- Assertions、Verdict、Score、Eligibility、Observability、Sources 与其它内建子功能使用私有官方 definition、
  显式内部 write grant 和同一个写入核。
- Application 安装第三方 definition 后，reader / projector 才能解释它，`niceeval migrate` 才能执行它拥有的
  相邻 migration。
- Group、Report、projector 与 migration converter 没有运行时 `record()` context。

## 范围

本方向包含：

- 一次声明多版本 definition、current schema、blob ref projection 与完整相邻 migration 图；
- application install、producer write grant 与 owner-local lease 的分离；
- Eval、Experiment、Plugin 与内建 producer 共用的写入命令；
- plain-data snapshot、blob builder、并发 reservation、失败 poison 与封口屏障；
- application-installed reader / projector 与显式 `niceeval migrate`；
- package-private `niceeval.*` namespace authority，以及官方事实的只读公共消费面。

它不改变 Record Core、portable layout、owner-local blob closure、完成标识、锁、Git 恢复点或 migration
sentinel。Projection、Relation、Derivation 与 Report 继续在上层定义。definition 不拥有 producer behavior
identity，也不自动建立 reuse presence requirement。

以下低层构造器不再从高层公共面导出：

- `defineJsonRecordAttachment()`；
- `defineRecordAttachmentFamily()`；
- `defineRecordAttachmentMigration()`；
- `makeRecordAttachmentWrite()`。

它们只作为 `defineRecordAttachment()` compiler 与中立写入核的 package-private 细节存在。

## 入口

- [Library](library.md) —— `defineRecordAttachment()`、`install` / `write`、`ctx.record()`、读取与 converter API。
- [Architecture](architecture.md) —— authority、identity、occurrence isolation、官方 namespace 与中立数据流。
- [Lifecycle](lifecycle.md) —— link、reserve、tracked command、poison、Plugin provenance 与封口顺序。
- [CLI](cli.md) —— application registry、迁移 plan、Git 恢复点与 sentinel。
- [Use Case](use-case/README.md) —— Eval、Experiment、Plugin、Sandbox、内建子功能、blob、读取与迁移的完整搭配。
