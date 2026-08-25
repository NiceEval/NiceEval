---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 多个 Attempt 怎样共用源码快照

源码 closure 属于 origin Run 的 `niceeval.sources` Run Attachment。多个 Attempt 不复制源码；后续 Run 引用历史 Attempt 时也只
保存 exact origin identity。

```text
Run R1 (sealed)
├─ Sources Attachment rows + Content chunks
├─ Attempt A1
└─ Attempt A2

Run R2 Member → { originRunId: R1, attemptId: A1 }
```

source site 保存 `SourceItemId`、digest 与坐标，不保存 SQLite rowid、Content chunk ordinal、path capability 或 connection。
reader 沿 Attempt 的 origin Run 取得 Sources；不能改读引用 Run、当前 worktree 或 cache。

相同 bytes 不建立跨 Run blob pool。每个 Content handle 属于自己的 logical Attachment closure，generic Content rows 只是 Host
private representation。改变 Sources owner、允许跨 Run Content handle 或 root 外 bytes 会改变 Core identity，不是 family
migration。

Sources body 通常按需读取：metadata 可由 bounded `read()` 取得，大 Content 用 `byteLength` 先看长度，再用 `stream` 分 chunk
消费。Scope close 与 generation lease 保证 migration 不会在 reader 背后改变 generation。

需要分享这组源码事实时，生成包含 R1 sealed closure 的 `RecordSnapshot`。不能复制 operational `record.sqlite`，因为它可能还含
其它 Run 的 unpublished rows 与 free-page residue。
