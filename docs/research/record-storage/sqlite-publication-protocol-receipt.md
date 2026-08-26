# SQLite publication protocol spike receipt

> 观察日期：2026-08-25
> 选择宿主条件：Linux 6.18.40，ext4/NVMe；Node 24.19.0 的 `node:sqlite`（本机 SQLite 3.53.3）

可复现实验：[`sqlite-publication-protocol-spike.mjs`](sqlite-publication-protocol-spike.mjs)。

```bash
node docs/research/record-storage/sqlite-publication-protocol-spike.mjs
```

该脚本使用真实、file-backed SQLite database 和独立 Node child process；不使用 fake 或 in-memory database 来证明 storage 行为。它在临时目录内完成所有 fixture，并在退出前删除 database、WAL、snapshot、migration target 和 child process。

## 已验证的协议形状

1. **Command retry。** 每个 append command 冻结 `commandId`、owner/run、writer generation、definition/family、logical identity 与 canonical payload digest。

   完全相同的重试重读已提交 row 并返回 `committed-success`。复用同一 `commandId` 但任一 identity 或 digest 不同会返回 `identity-conflict`，不新增、改写或静默当作 duplicate。

   Child 在 SQLite commit 后、ack 前被 `SIGKILL`。同一冻结 command 的重试仍确认 `committed-success`，且没有第二 row。

2. **Seal fence。** `open → sealing` 是推进 writer generation 的短事务。旧 generation 的重复或延迟 append 都被同一事务内的 state/generation guard 拒绝。

   最终 Seal 事务重新读取 fenced generation 与全部 inventory，插入 exact Seal entries 后才切 `sealed`。Child 在首条 Seal row 已插入、尚未 `COMMIT` 时被 `SIGKILL`；重开得到 `sealing`、零 Seal rows，ordinary reader 不可见。

   Recovery finalizer 重新核对 inventory 后恰好 seal 一次。重复 finalizer 不增加或改写 Seal；Seal 和 closure 的双向核对没有发现 missing/extra entry。
3. 子进程 `SIGKILL` 还测试 fence 前、fence 后以及 Seal commit 后/receipt 前。前两者分别恢复为 `open` 或 `sealing`，都对 ordinary reader 不可见；最后一种恢复为 `sealed`，receipt 可由 stable database 重建。
4. active snapshot 有显式 admission closed / in-flight drained 边界。`backup()` 完成后立即重新开放 source admission；删除 `open`/`sealing` closure、Seal 验证和 `VACUUM INTO` 都在独立 target 完成。实验把独特 secret marker 写入 open row，并同时检查 share-safe database 的 logical query 与 raw bytes，二者都不含 marker。强制 target validation failure 的路径会删除 target。
5. copy-on-write schema migration 要求 parent 先关闭全部 source connection。child 用 SQLite backup 形成 target，验证 identity、sealed content digest 与 unknown-family raw bytes，fsync target 后 atomic rename 到 stable path，并 fsync parent directory。pre-rename 与 post-rename/pre-receipt 的 `SIGKILL` 重开分别得到完整 source revision 或完整 target revision；receipt 都能重建，不会有半状态。

## Threat model 与边界

该 spike 证明的是本机受信 Record Host 在 Linux/ext4 上正确使用 SQLite transaction、backup、`rename` 与 fsync 的协议边界。它**不**证明攻击者同时修改本地 database、WAL、target 或目录时仍安全；那需要不同的完整性/权限 threat model。

Linux/ext4 是这里的选择参考，而不是跨平台原子性证明。它也不是性能 benchmark 或性能承诺：fixture 被有意保持很小，只验证协议形状。

本收据仍未证明 FIFO admission，也未证明 macOS、Windows、network filesystem 或任意 filesystem 上的 atomic-rename / directory-fsync 语义。生产采用仍须将 writer admission、platform capability 和 maintenance lease 作为 Host-owned 机制实现并分别验收。
