# 多个 Attempt 怎样共用源码快照

Eval 源码快照属于 Run-owned `niceeval.sources/v1`。Attempt 不各自复制源码，也不在 Core 保存 source path。

## 同一个 origin Run

```text
Run R1
  ├─ niceeval.sources/v1
  │    ├─ manifest
  │    └─ Run-local blobs
  ├─ Attempt A1
  └─ Attempt A2
```

A1 与 A2 都由 R1 实际产生时，可以通过同一个 origin Run 读取这份源码快照。Attempt-owned Assertions 若携带 source location，其 `path` 与 `digest` 必须匹配 origin Run 的 sources entry。

## 后续 Run 引用历史 Attempt

```text
Run R2 / Member
  → { originRunId: R1, attemptId: A1 }
  → R1 / niceeval.sources/v1
```

R2 采用 A1 时只保存精确 Attempt reference，不复制 A1 或 R1 的 RecordAttachment。source viewer 沿 A1 的 origin Run 读取，不能改读 R2 或当前 worktree。

origin Run 只进入 reader 的 dependency closure，不因此进入 Sample 分母。

十个 slot 指向同一个 origin Run 时仍是十条逻辑访问。宿主可以按 owner 与 projector token
去重一次物理 projection。

读取 sources Attachment 时，read Effect 会先 materialize 它的完整 blob closure，并
deep-freeze decoded JSON payload。

projector 随后只同步消费自包含内存 value。即使 reader Scope 已关闭，展示源码也不会再次
触发磁盘 I/O，亦不能以 mutation 改写其它 consumer 的 payload 视图。

## SHA-256 不替代源码 bytes

Sources RecordAttachment 使用 manifest 与 Run-local SHA-256 blobs。digest 属于 Sources 领域契约，用于确认内容身份并把 Assertion source location 连接到当时的源码；Run 完成标识本身不保存 hash。

Record 仍保存实际 source bytes。只保存 hash 会让离线 Report 无法展示源码，也无法证明一个外部同名文件就是当时内容。

## 跨 Run 不建立 blob 引用

两个 Run 各自产生新的 Attempt 时，即使源码 bytes 和 digest 相同，每个 Sources RecordAttachment 仍拥有自己的 closure。

RecordAttachment blob ref 只能指向同一 RecordAttachment directory 的 `blobs/**`。跨 Run 或跨 RecordAttachment 的全局 blob pool 会改变 owner、portable closure 与路径公理，不能作为 Sources payload 的普通 schema 演进。

本用例不声明 sources entries 与 expected Eval 的集合等式，也不推断一个全-reference Run 必须保存哪些当前源码。可依赖的读取规则只有一条：Attempt 的历史源码始终由它的 origin Run 拥有。

## 相关阅读

- [Attempt origin 与 reference](../architecture.md#core-v1)
- [Run RecordAttachment](../../../observability.md)
- [Attempt source location](../../assertions/architecture.md#source-位置)
