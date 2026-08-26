# Root-wide SQLite 采用收据

> 观察日期：2026-08-25
>
> 本机：Linux 6.18.40、ext4/NVMe、AMD Ryzen 7 5800X、8 cores / 16 threads、32 GiB RAM
>
> 文档性质：Design 选择证据，不是实现 benchmark 或性能承诺

本收据回答 root-wide SQLite 是否能承担 Record 的 chunk、item、Seal、snapshot、migration 与并发短事务。
可复现脚本是 [`root-wide-sqlite-spike.mjs`](root-wide-sqlite-spike.mjs)。

## 版本边界

本地命令：

```bash
node --version
node --expose-gc docs/research/record-storage/root-wide-sqlite-spike.mjs
npm view drizzle-orm@0.45.2 exports --json
npm view drizzle-orm@1.0.0-rc.4 exports --json
```

| 能力 | 最低版本或观察值 | 证据 |
|---|---|---|
| `node:sqlite` RC | Node 24.15.0 | Node 24.15.0 release 把模块标为 release candidate |
| WAL-reset 修复 | Node 24.15.0 携带 SQLite 3.51.3 | SQLite 3.51.3 修复并发 WAL writer/checkpoint 可能触发的 corruption bug |
| `setAuthorizer` | Node 24.10.0 | Node API history |
| defensive mode | 24.12.0 提供；24.14.0 默认开启 | Node API history |
| runtime `limits` | Node 24.15.0 | Node API history |
| `backup()` | Node 23.8.0 / 22.16.0；模块级 async function | Node API history 与本地 runtime introspection |
| 本地实际 runtime | Node 24.19.0、SQLite 3.53.3 | `sqlite_version()` 与 `sqlite_source_id()` |

PLAN-4 的最低 Node 版本因此是 **24.15.0**。
单独的 `engines.node >=24` 不能保证 WAL 修复与 runtime limits 同时存在。

一手资料：

- [Node 24.15.0 release](https://nodejs.org/en/blog/release/v24.15.0)
- [Node 24 `node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [SQLite WAL-reset bug](https://www.sqlite.org/wal.html#walreset)
- [SQLite 3.51.3 release history](https://www.sqlite.org/changes.html#version_3_51_3)

## Drizzle 边界

2026-08-25 的 npm registry export map 显示：

| Package | dist-tag | `./node-sqlite` export |
|---|---|---:|
| `drizzle-orm@0.45.2` | `latest` | 否 |
| `drizzle-orm@1.0.0-rc.4` | `rc` | 是 |

Drizzle 的 [Node SQLite guide](https://orm.drizzle.team/docs/sqlite/connect-node-sqlite) 也要求安装 `drizzle-orm@rc` 与 `drizzle-kit@rc`。
稳定版尚不能直接承接 `node:sqlite`，RC 不进入核心持久格式 runtime。

Drizzle Kit 生成 SQL 也不能证明 family bytes、Run Seal、unknown-family closure 或 publication 完整性。
这些仍是 Record Host 自己的协议。

## Fixture

脚本使用一份真实 file-backed WAL database，不使用 in-memory database 代替 storage 行为。

| 维度 | 规模 |
|---|---:|
| logical Content | 3 个，各 48 MiB，合计 144 MiB |
| producer fragment | 17 B 到 2 MiB，边界不等于 durable chunk |
| durable chunk row | 1 MiB，共 144 rows |
| collection item | 50,000 个，共 1.25 MiB canonical payload |
| concurrent writers | 4 processes × 250 `synchronous=FULL` transactions |
| snapshot pressure | backup 期间另一个 process 连续提交 1,000 transactions |
| schema migration | 147.75 MiB database 的 chunk table rebuild |

所有临时 database、snapshot 与 corruption fixture 都在命令结束前删除，子进程也已经终止。

## Content 与 collection

| 操作 | 结果 |
|---|---:|
| 144 MiB chunk write | 715.472 ms |
| write peak RSS delta | 24.03 MiB |
| stream read + SHA-256 | 153.764 ms |
| read peak RSS delta | 55.25 MiB |
| digest、length、order | 全部一致 |
| 50,000 item append | 190.276 ms；50,000 retained |
| 50,000 item full-array read | 68.207 ms；RSS delta 32.88 MiB |

Host 在 32 MiB whole-value admission 下只读 `byte_length`，并在读取 chunk 前拒绝 48 MiB 整体分配。
同一 Content 的 stream 路径仍成功。

validator 使用 row iterator，在第 10 个 chunk 后停止。
这证明 `node:sqlite` 的同步 statement 不妨碍 Host 在 row 边界检查取消；它不证明单条 SQLite call 可以被中断。

## Writer 与 snapshot

四个 writer 完成了 1,000/1,000 个事务，总 wall time 676.928 ms。
每个 writer 都取得进展，但首次 commit 等待分别为 0.829、179.445、430.124 与 530.193 ms。

这个结果不能证明 SQLite lock 公平。
PLAN-4 仍须在 Host 层限制 batch，并让等待超过 deadline 的 caller 得到 typed contention failure。

`backup()` 在连续写入期间发生 1,001 次 restart。
它在 writer 完成后用 1,890.859 ms 形成 37,826-page snapshot；snapshot 含完整 1,000-row prefix，`integrity_check` 为 `ok`。

因此 active Host snapshot 不能依赖 backup 自己在无限写流中取得进展。
Host 必须先停止接纳新 transaction、排空当前 transaction，再执行 backup 与目标验证。

## Crash、migration 与 hardening

| 场景 | 结果 |
|---|---|
| Seal commit 前 `SIGKILL` | Run 保持 `open`，Seal rows 为 0 |
| Seal commit 后、receipt 前 `SIGKILL` | Run 为 `sealed`，Seal rows 为 1 |
| known-family typed migration | revision 1 → 2 |
| unknown-family bytes | revision 7 与 SHA-256 原样保持 |
| 147.75 MiB table rebuild | exclusive lock 1,421.612 ms |
| rebuild 后 checkpoint | database 291.96 MiB；Content digest 全部保持 |
| 停稳 copy | 273.991 ms；`integrity_check=ok`，digest 保持 |
| `SQLITE_FULL` | transaction 失败并 rollback，新增 rows 为 0 |
| 截断 database | reader/integrity check 拒绝 |

table rebuild 让 database 保留约一份旧表大小的 free pages。
需要重写大表的 schema migration 应预检至少一份额外 database 空间，并优先用 copy-on-write target 验证后替换。

hardening spike 还确认：

- defensive mode 拒绝写 `sqlite_schema`；
- extension loading 保持关闭；
- runtime `attach` limit 为 0，reader authorizer 也拒绝 `ATTACH`；
- trigger 拒绝修改 sealed Run；
- read-only reader 只用固定 statement 查询 `sealed` facts。

## Worker 启动

20 次“启动 worker thread → read-only open → schema query → close”的结果为：

| p50 | p95 |
|---:|---:|
| 32.846 ms | 57.792 ms |

持续 writer 使用专用 storage worker，可以隔离同步 busy wait 与 fsync。
短生命周期 `show/query` 直接使用 read-only connection，避免为一次查询支付 worker startup。

## 对选型的解释

结果支持 root-wide SQLite，而不是自定义 rolling pack：

1. chunk rows 通过 144 MiB Content、digest 与有界 RSS fixture；
2. SQLite 原生提供 transaction、index、crash recovery、backup 与 schema substrate；
3. fixed reader 可以关闭 arbitrary SQL、extension 与 `ATTACH`；
4. crash 前后由 Seal transaction 唯一决定可见性，receipt 可以在 commit 后重建；
5. custom pack 仍须另行实现 framing、catalog、index、recovery、migration 与 snapshot。

结果也固定了 PLAN-4 不能省略的 Host 协议：snapshot barrier、bounded write batch、typed contention 与 exact Seal。
结构 ceiling、copy-on-write rebuild 与 unknown-family byte preservation 同样由 Host 拥有。

本收据不构成跨硬件性能承诺，也不证明 SQLite 自带公平 writer queue。
Git binary merge、长期 database growth 与具体生产结构 ceiling 仍须在实现采用时验证；它们不改变 SQLite 与 rolling pack 的职责差异。
