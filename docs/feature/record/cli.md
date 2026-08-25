# Record CLI

CLI 默认通过 `ProjectRecordStore` 打开项目内 `.niceeval/record/record.sqlite`。`query`、`view` 与 `exp --dry` 只读 sealed
Run；`exp` 通过 dedicated storage worker 写入 operational database。ordinary command 不自动 migrate、checkpoint、clean 或
执行 Git 操作。

## Operational store 与 `--record`

默认项目 store 是 Host-owned operational database，不是用户可搬运输入。`--record` 只接受 Host 生成并关闭、经过
sealed-only sanitization 与 exact validation 的 `RecordSnapshot`：

```sh
niceeval query discover --record ./snapshots/baseline.record-snapshot
niceeval view --record ./snapshots/baseline.record-snapshot
```

raw `.niceeval/record/record.sqlite`、其 main-file copy、`-wal` 拼接、未关闭 backup 与任意 SQLite file 都不能冒充
`RecordSnapshot`。copy、Git 与 `--record` 只接受 Snapshot。导入时 Host 按 hostile input 在受限 maintenance unit 中验证；
验证失败不以 partial data 打开。

Record 可能包含源码、prompt、conversation、Content 与第三方 family bytes。进入 Git 或分享前，用户仍负责权限、脱敏与
保留策略；Snapshot 的 sanitized 表示只保证没有 operational `open` / `sealing` closure 和残留 free-page bytes，不替用户判断
业务内容是否敏感。

## Command resource behavior

| command | resource path | mutation |
|---|---|---|
| `niceeval query` | short read-only fixed operations | none |
| `niceeval view` | short read-only operations per detail request | none |
| `niceeval exp --dry` | sealed reads only | none |
| `niceeval exp` | one process storage worker + bounded short writes | own open Run, then final Seal |
| `niceeval record snapshot` | exclusive snapshot barrier only while fixing source | creates a separate Snapshot |
| `niceeval clean` | exclusive maintenance | removes revalidated incomplete rows |
| `niceeval migrate` | exclusive maintenance | adjacent schema/family migration |
| `niceeval state migrate --all` | OS-user state maintenance | first-party Service modules only |

`query` 不启动 storage worker，也不长期保持 SQLite read transaction。`view` 保存 sealed logical cutoff；detail request 用
短 connection 重开同一 immutable facts。

## `exp`

Host 在模型、Sandbox、provider 或付费调用前打开并验证 store revision。predecessor 返回
`record-schema-migration-required`，newer/foreign schema 返回 `record-schema-unsupported`；ordinary execution 不隐式维护。

writer append 的成功反馈只表示 command 已被 bounded mailbox 接纳。CLI 在结束 Run 前调用所有 Attempt completion fence：
它关闭新 admission、等待 backlog、拒绝未显式 close 的 active collection，并传播后台 storage failure。Run finalizer 随后在
transaction 外验证 closure，最终 transaction 原子写 Seal 并切换 `sealed`。只有 commit 后才输出成功 receipt。

其它 process 可以持续读取 sealed Run。write contention 在 deadline 内等待 Coordination ticket 与 SQLite lock，超时返回
`record-write-busy`；它不被写成 collection partial。

## `query` 与 `view`

局部 query 只解释调用方贡献的 definition。结果规则为：

- 请求 family 不存在：`not-recorded`；
- current known family 通过 decoder、invariant 与 closure：`available`；
- known current rows、reference 或 Content 不合法：该 Attachment 为 `invalid`；
- inventory 含无关 unknown family：继续读取；
- direct/reference closure 需要 unknown family：`family-definition-required`；
- known predecessor family：`migration-required`。

whole-value `read()` 超过本机 admission 时返回 `record-content-admission` 并建议流式 operation；Host 不先分配完整数组。
Content 的 whole bytes/text 同样先 admission，stream 仍可用。

需要完整 inventory 的 export、Snapshot 或 `requireComplete()` 必须拥有全部 definition，并验证 exact Seal。局部 view 成功不等于
整份 store 已通过完整验证。

## Snapshot

```sh
niceeval record snapshot --output ./snapshots/baseline.sqlite
```

命令先按 source bytes、可用空间、观测 throughput 与 deadline preflight，再短暂阻止新 write transaction、排空已经开始的
transaction 并执行 SQLite backup。source 固定后立即释放 barrier；producer backlog 继续。命令在独立 target 删除 unpublished
closure，`VACUUM INTO` sealed-only database，验证 exact Seal、checkpoint 并关闭，然后才发布 Snapshot receipt。

deadline 或预算不足返回 `record-snapshot-busy`，不留下可被 `--record` 接受的结果。

## Migration 与 clean

`niceeval migrate` 先识别 storage revision 与 family revision。physical schema migration 使用 checked-in adjacent SQL；family/data
migration 使用 typed adjacent converter。ordinary command 从不执行 Drizzle 或生成 SQL。大表 rebuild 使用 copy-on-write target，
验证成功才替换 source。

`niceeval clean` 只在 exclusive maintenance 下删除重验后仍为 `open` / `sealing` 的 rows。它不删除 sealed invalid facts，
也不处理 cache、credential 或 user Service state。

OS-user `state.sqlite` 的 migration 由 `niceeval state migrate --all` 或请求该 Service 的 fixed operation 触发。只有静态第一方
namespaced module 可以参与；unknown/newer namespace 原样保留，不能通过 CLI 注入 SQL、module、table 或 operation。

## Errors 与下一步

| code/state | meaning | next step |
|---|---|---|
| `record-write-busy` | writer admission 或 SQLite lock 超过 deadline | 稍后重试；没有业务 partial |
| `record-snapshot-busy` | barrier、空间或 deadline 不能形成一致 Snapshot | 释放 contention 或调整输出资源后重试 |
| `record-schema-migration-required` | operational schema 是 supported predecessor | 显式运行 `niceeval migrate` |
| `record-schema-unsupported` | format/schema identity 不是相邻支持链 | 使用支持该 schema 的 NiceEval |
| `record-database-invalid` | SQLite structure、schema allowlist、typed row 或 Seal 无效 | 停止普通读取并进行受限维护/重新取得 Snapshot |
| `record-content-admission` | whole-value allocation 超过 admission | 使用 collection/Content stream |
| `record-command-conflict` | command identity 与 frozen facts 不一致 | writer fail closed；不要自动重跑 producer |
| `family-definition-required` | direct/closure/full operation 缺 definition | 启用对应 package 后重试 |
| `migration-required` | known family data revision 是 predecessor | 显式运行 `niceeval migrate` |
| `service-state-migration-required` | 请求的 Service module 需要相邻维护 | 运行授权的 state migration |
| `service-state-invalid` | namespace、schema identity 或 typed row 无效 | 停止该 Service operation并维护 state store |
