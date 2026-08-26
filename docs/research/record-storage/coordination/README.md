# SQLite Record Coordination research

本目录保存 Record writer admission 与 snapshot barrier 的多进程采用证据。
研究脚本只验证 Host protocol，不定义 Record validity。

## 采用证据

- [SQLite Coordination 多进程 spike](sqlite-coordination-spike.mjs) 使用 file-backed SQLite、独立 Node processes 与真实 filesystem Coordination candidate。
- [SQLite Coordination 多进程采用收据](sqlite-coordination-receipt.md) 给出 Linux/ext4 上的 FIFO、取消、owner crash recovery、公平进展与 snapshot barrier 观察值。
- [SQLite publication protocol 收据](../sqlite-publication-protocol-receipt.md) 另行验证 Run publication、sealed-only snapshot 与 copy-on-write migration；它不证明 writer FIFO。

```bash
node docs/research/record-storage/coordination/sqlite-coordination-spike.mjs
```

脚本只在临时目录创建 operational database、Coordination sidecar、snapshot 与 gate 文件。
父进程在 `finally` 终止未退出 child 并删除整个 fixture，成功时向 stdout 输出一份 JSON receipt。

## Candidate 边界

`state.json` 是 ticket sequence、current owner 与 barrier 的跨进程权威。
每次变更先取得短期 filesystem mutex，再用 file sync、atomic rename 与 directory sync 发布新 revision。
mutex 和 writer owner 都携带同主机 PID 与 expiry；只有 expiry 已到且 PID 返回 `ESRCH` 时，后继才回收 owner。

每张 writer ticket 最多包围一个 `BEGIN IMMEDIATE` transaction。
有 backlog 的 writer 提交后释放 ticket，再取得更大的 durable sequence 并排到队尾。
barrier request 与 writer admission 共用一份权威状态，因此 request 发布后不会开始新 transaction；已经开始的 transaction 仍可提交并释放 owner。

SQLite commit 与 stable command identity 才决定 Record facts。
Coordination sidecar 可以在全部 owner 停稳后删除并重建，但重建不能创造、删除或改写已提交的 Record command。
这项边界由删除期间的相同 validity digest，以及重建后的相同 command replay 共同验证。

该 candidate 是 PLAN-4 的采用证据；production Coordination 仍未采用这套 FIFO 与 barrier。
对应目标边界见 [PLAN-4 Architecture](../../../design/record-storage/PLAN-4/architecture.md) 与 [PLAN-4 Lifecycle](../../../design/record-storage/PLAN-4/lifecycle.md)。
