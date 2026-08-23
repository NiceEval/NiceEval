# 多个 Attempt 怎样共用源码快照

源码闭包属于 origin Run 的 `niceeval.sources`。Attempt 不各自复制源码，也不把 host path 或 blob
ref 写进 Core。

## 同一个 origin Run

```text
Run R1
├─ niceeval.sources
│  ├─ SourceItemId manifest
│  └─ Run-local blobs
├─ Attempt A1
│  └─ assertions / diagnostics source-site joins
└─ Attempt A2
```

R1 的每个 origin Attempt 都通过自己的 `originRunId` 读取同一个 Sources manifest。Assertion 和
diagnostic 的 source-site 只保存 `sourceItemId`、digest 和坐标；它们不携带 Sources blob、storage path、
Run handle 或读取 capability。

`SourceItemId` 是 manifest 内稳定 identity，不是数组下标、path、digest 或 blob key。每个 item 的
canonical project-relative path、SHA-256 和 own blob 表示当时的内容。离线 reader 因而可以展示并
核对当时源码，而不读取现在的 worktree。

## 后续 Run 引用历史 Attempt

```text
Run R2 / Member
  → { originRunId: R1, attemptId: A1 }
  → R1 / niceeval.sources
```

R2 采用 A1 时只保存精确 Attempt reference，不复制 A1 或 R1 的 Attachment。source viewer 沿 A1 的
origin Run 读取，不能改读 R2 或当前 worktree。origin Run 可以进入 reader 的 dependency closure，
但不因此进入 R2 的逻辑 Sample denominator。

十个 Slot 指向同一个 origin Run 时仍是十条逻辑引用。宿主可以按 owner 与固定读取种类去重一次
物理读取；这个 cache 不会改变每条 Member 的语义。

## 不建立跨 Run blob pool

即使两个 Run 的源码 bytes 和 digest 完全相同，每份 Sources Attachment 仍拥有自己的 closure。一个
`RecordBlobRef` 只指向同一 Attachment directory 的 `blobs/`，不能指向另一个 Run、另一个 family 或
全局 blob pool。

改变为跨 Run blob pool、允许 root 外文件，或改变 Sources owner，会改变所有 reader 必须理解的
Core 公理。这不是 Sources payload 的小改，而是下一 Record format 的工作。

## 惰性读取不改变 ownership

`RecordReadSession` 只在 source viewer 或 Analysis query 实际请求 Sources 时读取 payload 和
closure。形成 `available` value 后，payload 已 deep-freeze，blob bytes 以 defensive copy 提供；Scope
关闭后展示继续消费内存 snapshot，不再触发磁盘 I/O。

## 相关阅读

- [Sources manifest](../architecture.md#sources-manifest)
- [Attachment closure](RecordAttachment怎样保存运行事实.md#一个-family-一份完整-closure)
- [跨文件 Eval 怎样进入源码闭包](跨文件Eval怎样进入源码闭包.md)
- [Assertions](../../assertions/README.md)
