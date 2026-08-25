# PLAN-2：一 Run 一 SQLite application file —— Lifecycle

本生命周期保留历史候选的 single-file publication 语义。
由于 final DB 不能 rollover，它不属于当前 storage Design 的可采用路径。

## Owner

| Owner | 责任 |
|---|---|
| family producer | 提交 rich value、plain-data item、Content source 与业务 limitation |
| Attempt writer | 管理 start/append、Host cap 与 Attempt completion |
| Run storage actor | 独占 active staging connection，执行 fixed statements、chunk backpressure 与 transaction |
| Run publisher | 停止 mutation、导出 final DB、验证、fsync、rename 与形成 receipt |
| reader | 以 hardened read-only connection 读取 requested closure |
| maintenance host | 只读旧 DB，在 staging 用 fixed exporter 形成新 storage revision |

## Active Run

```text
create local staging DB + actor
  → write Core and logical commands in short transactions
  → append collection rows / Content draft chunks
  → complete Attempts and finalize logical Attachments
  → stop commands and drain actor
  → reject in-flight or unresolved drafts
  → write logical staging Seal
  → fixed export into new exact final DB
  → full validate and close final DB
  → no-replace rename final file
  → fsync destination parent
  → hardened read-only destination verification
  → receipt
```

final export 是 O(run bytes)，临时空间按接近两份 Run bytes 预算。
资源不足返回 typed publication failure，不把热 DB 作为退路。

final DB 达到共同 durable-member ceiling 时，publisher 必须失败。
它不能把一个 Run 自动发布成多个 application files，也不能把 member ceiling改成 Host 私有值。

## Fairness 与取消

actor 对 item transaction 和 bounded Content chunk transaction 实行公平队列。
一个 Content source 不能持有 writer 直到 EOF；每个 chunk 后必须允许其它 ready command 前进。

producer 取消会停止后续 chunk 并使 logical write失败。
draft rows 留在 unpublished staging，由 Run failure/recovery 释放；它们不成为 collection partial 或 published Content。

## Crash 与 recovery

- final export 前/中失败：portable path absent，partial final file只在 local staging。
- final validation 后、rename 前失败：portable path absent；recovery 可重验同一 final candidate。
- rename 后、parent fsync 前崩溃：path 可能 absent 或 present；present 必须 full revalidate。
- destination 验证后、receipt 前崩溃：recovery manifest 只补验和 receipt，不重跑 producer。
- destination 重验失败：file 保持 invalid/unavailable，不删除、不以同名 file替换，也不返回成功 receipt。

rename 是 publication commit；SQLite transaction 只保证 database 内 logical state。

## Storage migration

maintenance host hardened-open source DB，执行 full source verification，再创建新的 active staging/final DB。
generic exporter 按 inventory 复制 Core、known/unknown family bytes、collection rows、Content chunks 与 references。

新 final DB 关闭并验证后才执行平台定义的 atomic replace。
Design 采用前必须穷尽 Linux old-fd/no-replace 语义，以及其它承诺平台的 replace 行为。
