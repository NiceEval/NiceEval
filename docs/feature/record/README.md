# Record：已封口运行的持久事实

Record 是 `<project>/.niceeval/record/` 中可复制、可纳入 Git 的运行事实集。
它只保存已经发生且已封口的事实，不保存当前进程的协调状态、缓存、分析结果或报告树。

```text
Experiment Host
  └─ RunWriteSession
       ├─ 创建并完成 origin Attempt
       ├─ 引用已发布的 Attempt
       └─ seal() ──▶ runs/<RunId>/complete

RecordReadSession
  └─ selectRuns() ──▶ RecordSelection
       └─ query 需要时才读取 Run、Attempt、Attachment 与 blob
```

一个 Record 是多份 immutable Run 的集合。每个 writer 只创建自己的新 RunId，并只修改这个
Run 目录。不同 writer 因而可以同时追加 Run，不需要全局 writer lock（写入锁）。
`complete` 是唯一的发布信号：它在全部内容已关闭、flush（刷盘）和校验之后最后排他创建。
没有 `complete` 的目录不是事实，reader 忽略它，并提示使用 `niceeval clean`。

## 固定协议

Record Core 固定 Run、Slot、Member 与 Attempt 的身份和引用。业务事实只落入 NiceEval
拥有的五个固定 Attachment family（附件族）：

| family | owner | 保存的事实 |
|---|---|---|
| `niceeval.assertions/v1` | Attempt | AssertionResult、Evidence 与已封口的检查结果 |
| `niceeval.observability/v1` | Run 或 Attempt | 对话、命令、用量、时间、诊断与 OTel 归一观察 |
| `niceeval.file-changes/v1` | Attempt | 此次 Attempt 观察到的文件变化 |
| `niceeval.sources/v1` | origin Run | 当时源码闭包的 manifest 与本 family blob |
| `niceeval.artifacts/v1` | Run 或 Attempt | 有媒体类型、身份和本 family blob 的大型文件 |

Adapter 与 collector 只能提交 NiceEval 提供的固定输入。Record 不提供动态 family、字段、writer
或 migration（迁移）注册。新增一种不可恢复事实时，由 NiceEval 修改该固定协议并发布版本。

每个 Attachment 都是 exact JSON 的 payload 和 owner-local blob closure（归属者局部 blob
闭包）。blob ref 不能指向另一个 Attachment、另一个 owner 或 root 外路径。读取时，完整
payload 与 closure 通过校验后才成为可用值。

## 读取、写入与维护

`RecordReadSession` 是 Scope-bound（资源作用域绑定）惰性 reader。它先选择已封口 Run，形成
只含身份、预期 Slot 和问题的 `RecordSelection`；它不把全部历史 payload 复制进内存。查询需要
某条 trace、diff 或 Evidence 时，才读取、exact decode（精确解码）并验证对应的内容。

`RunWriteSession` 只拥有一个新 Run。它可以并行创建自己的 Attempt，也可以引用在本次读取选择中
已经发布的 Attempt。`seal()` 拒绝新写入，等待本 Run 的 Attempt 与 collector 停稳，验证 Core、
引用与五个固定 family，随后以 `complete` 发布。

普通读取与写入只接受当前格式。受支持的旧 schema 必须通过 `niceeval migrate` 显式迁移。
迁移只执行 NiceEval 自带的相邻步骤，并在改写历史字节前要求干净且可恢复的 Git 状态。失败或中断
会留下 `migration.in-progress`；普通访问 fail closed（失败即关闭访问），用户用 Git 完整恢复
`.niceeval/record` 后重新迁移。v1 只接受 exact v1 bytes；其它格式是 `unsupported-format`。

## 入口

- [Library](library.md) —— Host SDK、Effect 边界、惰性 reader、Run writer、错误与维护 API。
- [Architecture](architecture.md) —— durable layout、Core、五个 fixed family、closure、发布与迁移不变量。
- [Observability Attachment](architecture/observability-attachments.md) —— 单一 Observability family 的精确 payload。
- [CLI](cli.md) —— `show`、`view`、`exp`、`clean` 与 `migrate` 的反馈。
- [Use cases](use-case/README.md) —— 并行追加、封口、源码闭包和 Git 恢复的完整路径。
