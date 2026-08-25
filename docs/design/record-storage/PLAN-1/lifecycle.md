# PLAN-1：JSON envelope + Host 私有 packs —— Lifecycle

## Owner

| Owner | 责任 |
|---|---|
| family producer | 提交 rich value、plain-data item、Content source 与业务 limitation |
| Attempt writer | 线性化 start/append，管理 cap，并在 Attempt complete 时形成 collection logical state |
| Record Host | 管理 staging directory、packs、indexes、digest、Seal、fsync、rename 与 recovery |
| reader | 按 catalog 解释 logical bytes；按 scope 打开和关闭 Content ranges |
| maintenance host | 在 exclusive authority 下执行 storage migration，不修改 logical family 语义 |

## Active Run

```text
create local staging directory
  → write Core draft
  → append collection frames / Content segments
  → complete Attempts and write Attachment envelopes
  → stop new mutations and join capture
  → validate every envelope/pack/index/reference
  → write seal.json and complete last
  → fsync files and directories
  → no-replace rename whole Run directory
  → re-open destination and return receipt
```

不同 Run 使用不同 staging directory 和 writer state，可以并行。
同 Run 的 append 只在 owner mutex 中分配 ordinal；pack file I/O 可以通过 Host queue 有界调度。

## Crash 与 recovery

- Run directory rename 前的任何进程终止只留下 local staging。
- pack 或 index 的 partial tail 不在 portable root；recovery 可以删除 abandoned staging，不能发布它。
- rename 后 destination 是完整 directory unit；receipt 丢失时 recovery 重验 destination，不重跑 producer。
- destination 重验失败时 Run 保持 invalid/unavailable，不删除既有 portable bytes，也不返回成功 receipt。

## Storage migration

maintenance host 只读 source Run，并在 local staging 形成新 storage revision。
known 与 unknown family 都按 envelope inventory、raw item frames、Content ranges 与 references复制。

新 closure 完整验证后，以平台支持的 atomic replace 规则发布。
普通 `show`、`view` 与 `read` 不静默改写 pack/index。

## 资源收尾

Scope finalizer 关闭 source Stream、pack/index descriptors 与 leases。
disk full、close、fsync 或 rename failure 都返回 typed storage failure；finalizer failure 不把未完成 staging 变成 published fact。
