# SQLite Coordination 多进程采用收据

> 观察日期：2026-08-25
>
> 选择宿主：Linux 6.18.40，ext4 `statfs` magic `0xef53`；Node 24.19.0 的 `node:sqlite`，SQLite 3.53.3

可复现实验：[`sqlite-coordination-spike.mjs`](sqlite-coordination-spike.mjs)。

```bash
node docs/research/record-storage/coordination/sqlite-coordination-spike.mjs
```

脚本使用 file-backed SQLite database 和九个独立 Node child process。
Coordination candidate 使用 durable `state.json`、atomic rename、file/directory sync 与 filesystem mutex，不使用 in-memory boolean 或 fake 充当跨进程权威。
成功运行输出结构化 JSON receipt，并在 `finally` 删除 temp fixture、snapshot、WAL、gate 与残留 child。

## Fixture 与批次

九个 child 的职责如下：

1. `holder` 持有首张 admission，给后续 waiter 建立确定的 durable queue。
2. `writer-a` 和 `writer-b` 各有两个 batch；每次提交后都重新 enqueue。
3. `canceled-writer` 在等待期间取消。
4. `crashing-writer` 在 admission 后执行 `BEGIN IMMEDIATE` 和 command insert，但在 commit 前被 `SIGKILL`。
5. `barrier-inflight` 在 transaction 内等待 barrier request。
6. snapshot child 请求 barrier、等待 drain、执行 SQLite backup，再立即释放 barrier。
7. `barrier-queued` 在 barrier request 后 enqueue，并等待 backup 完成。
8. 最后一个 replay child 在 Coordination 删除和重建后再次提交 `holder:0`。

首代 Coordination 产生九张 ticket，其中八张取得 admission，一张在 waiting 状态取消。
五个有限、健康且未取消的 writer 全部至少 commit 一个 batch 并正常退出。
首代 database 最终保存七个 bounded batch；replay child 另 commit 一个 transaction，但 stable identity 把它识别为相同 command，不新增 Record fact。

## FIFO 与每 ticket 一个 batch

本次权威 ticket 与 admission 次序如下：

| Sequence | Writer | Batch | 终态 | Admission ordinal |
|---:|---|---:|---|---:|
| 1 | `holder` | 0 | `done` | 1 |
| 2 | `writer-a` | 0 | `done` | 2 |
| 3 | `canceled-writer` | 0 | `canceled` | — |
| 4 | `writer-b` | 0 | `done` | 3 |
| 5 | `crashing-writer` | 0 | `abandoned` | 4 |
| 6 | `writer-a` | 1 | `done` | 5 |
| 7 | `writer-b` | 1 | `done` | 6 |
| 8 | `barrier-inflight` | 0 | `done` | 7 |
| 9 | `barrier-queued` | 0 | `done` | 8 |

取消项移除后，durable sequence 与 admission sequence 都是 `1, 2, 4, 5, 6, 7, 8, 9`。
`writer-a` 从 sequence 2 重新排到 6，`writer-b` 从 4 重新排到 7；两张新 ticket 都排在初始 queue tail 5 之后。

SQLite schema 让 `ticket_id` 保持 unique，脚本还按提交结果分组检查每个 ticket 最多对应一行 command。
crash ticket 5 没有 commit，因此 database 不含 `crashing-writer:0`。

## Cancel 与 owner crash recovery

waiting ticket 3 被 child 自己原子标记为 `canceled`，没有取得 admission，也没有写入 SQLite。
后继 ticket 4 随后 commit `writer-b:0`，证明取消项不会挡住队首推进。

ticket 5 取得 owner lease 并开始 `BEGIN IMMEDIATE` 后，父进程向 child 发送 `SIGKILL`。
本次 lease expiry 为 `1787666502819`，后继在 `1787666502830` 回收 owner，即 expiry 后 11 ms。
回收同时观察同主机 PID 的 `ESRCH`，不能只因时钟到期就接管仍存活的 owner。

被杀 child 的未提交 command 由 SQLite rollback recovery 清除。
后继 ticket 6 随后取得 admission 并 commit，证明已知死亡的 owner 不会永久阻塞 queue。

## Snapshot barrier

ticket 8 已取得 admission，并在 `1787666502987` 执行 `BEGIN IMMEDIATE`。
barrier 在 `1787666503030` 发布 request；此时它明确观察到 ticket 8 是 current owner。
ticket 9 随后 enqueue，但在 barrier release 前没有开始 transaction。

in-flight writer 在 `1787666503293` commit 并释放 owner。
barrier 于 `1787666503306` 进入 active，SQLite backup 于 `1787666503310` 完成，并在 `1787666503313` 立即释放。
queued writer 于 `1787666503325` 开始 transaction，并在下一毫秒 commit。

backup 含六条 command，包括 barrier request 时仍 in-flight 的 `barrier-inflight:0`。
backup 不含 release 后才提交的 `barrier-queued:0`；live database 则包含这两条 command，共七条。
这些观察证明 barrier 先关闭新 admission，再等待已开始的 transaction 排空，backup 完成后让 queue 继续。

## Coordination 不是 Record validity

首代 SQLite facts 的 canonical digest 是 `db435fc91966359dfc1f071c358f06bd07f511afe962804760e834a2270fe128`。
脚本在所有 owner 停稳后删除整个 Coordination directory，再直接读取 SQLite；command count 与 digest 都不变。

随后脚本建立全新的空 Coordination state，并在独立 child 再次提交 stable command identity `holder:0`。
transaction 正常 commit，但相同 identity 与 payload 被识别为 duplicate；SQLite 仍为七条 command，digest 仍相同。
因此 ticket、lease 和 barrier 只决定谁能尝试 transaction，SQLite commit 与 stable command identity 才决定 Record facts。

## 证明边界

这是一份 Linux/ext4 单机选择参考，不是跨平台 filesystem 语义证明。
它不证明 macOS、Windows、network filesystem、任意 filesystem 或 hostile local modifier 下的正确性。
它也不证明 production Coordination 已经采用该实现；生产代码仍需把相同不变量收敛到 Host-owned protocol，并由公开入口另行验收。
