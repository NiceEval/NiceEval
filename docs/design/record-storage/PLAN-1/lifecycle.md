# PLAN-1：JSON envelope + Host 私有 packs —— Lifecycle

## Owner

| Owner | 责任 |
|---|---|
| family producer | 提交 rich value、plain-data item、Content source 与业务 limitation |
| Attempt writer | 线性化 start/append，管理 cap，并在 Attempt complete 时形成 collection logical state |
| Record Host | 管理 staging directory、rolling data/metadata packs、small roots、digest、Seal、fsync、rename 与 recovery |
| reader | 按 catalog 解释 logical bytes；按 scope 打开和关闭 Content ranges |
| maintenance host | 在 exclusive authority 下执行 storage migration，不修改 logical family 语义 |

## Active Run

```text
create local staging directory
  → write Core draft
  → append collection frames / Content segments and roll data/index/catalog packs
  → complete Attempts and write Attachment envelopes and small roots
  → stop new mutations and join capture
  → validate every envelope/root/page/pack/reference
  → write and fsync rolling Seal pages
  → write and fsync Seal root, then complete
  → fsync staging directory
  → no-replace rename whole Run directory
  → re-open destination and return receipt
```

不同 Run 使用不同 staging directory 和 writer state，可以并行。
同 Run 的 append 只在 owner mutex 中分配 ordinal；pack file I/O 可以通过 Host queue 有界调度。

rollover 只关闭当前 pack、写入 authenticated descriptor 并打开下一个 pack，不提交新的 logical value。
单 logical Content、collection、index 或 Seal inventory 可以跨 pack files；producer 看不到 rollover。

同一次 rich write 逐份消费 Content source；已完成 Content 只保留 descriptor/digest state，不保留完整 bytes。

## Crash 与 recovery

- Run directory rename 前的任何进程终止只留下 local staging。
- pack/page 的 partial tail、未闭合 root 与 rollover descriptor 不进入 published Seal；recovery 可以删除 abandoned staging，不能发布它。
- root 指向缺失、截断或未进入最终 Seal inventory 的 page/pack 时，候选不能发布，也不能把可读 prefix 当作业务 partial。
- rename 后 destination 是完整 directory unit；receipt 丢失时 recovery 重验 destination，不重跑 producer。
- destination 重验失败时 Run 保持 invalid/unavailable，不删除既有 portable bytes，也不返回成功 receipt。

## Storage migration

maintenance host 只读 source Run，并在 local staging 形成新 storage revision。
known 与 unknown family 都按 envelope、roots、raw item frames、Content ranges、pack descriptors 与 references复制。

从当前 digest-file layout 进入第一版 rolling codec 时，相邻 converter 按旧 envelope inventory读取 bytes。
它保留 payload、Content、family revision、references 与 logical digest，并流式生成新的 pack/index/catalog/Seal closure。
unknown family 使用同一 generic inventory 路径，不调用 family Schema，也不改变 logical bytes。

新 closure 完整验证后，以平台支持的 atomic replace 规则发布。
普通 `show`、`view` 与 `read` 不静默改写 pack/index。
旧 storage revision 由 ordinary reader 返回 typed `storage-migration-required`，不能误报 corruption 或长期双解码。

## 资源收尾

Scope finalizer 关闭 source Stream、pack/page descriptors 与 leases。
family `maximumBytes`、storage structure ceiling、disk full、close、fsync、取消或 rename failure 都返回 typed failure。
单 Content 或 Content 合计只因超过旧 64/128 MiB 不能失败；finalizer failure 也不能把未完成 staging 变成 published fact。
`requireComplete()` 与 seal 全量流式校验且可取消；资源不足返回 resource/cancel，不冒充 durable corruption。
