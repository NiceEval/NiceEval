# Record CLI

CLI 默认通过 `ProjectRecordStore` 打开项目内 `.niceeval/record.sqlite`。`query`、`view` 与 `exp --dry` 只读 sealed
Run；`exp` 通过 dedicated storage worker 写入 operational database。ordinary command 不自动 migrate、checkpoint、clean 或
执行 Git 操作。

## Operational store 与 `--record`

默认项目 store 是 Host-owned operational database，不是用户可搬运输入。`--record` 只接受 Host 生成并关闭、经过
sealed-only sanitization 与 exact validation 的 `RecordSnapshot`：

```sh
niceeval query discover
niceeval query explain --record ./snapshots/baseline.record-snapshot --request request.json
niceeval view --record ./snapshots/baseline.record-snapshot
```

raw `.niceeval/record.sqlite`、其 main-file copy、`-wal` 拼接、未关闭 backup 与任意 SQLite file 都不能冒充
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

`query` 不启动 storage worker，也不长期保持 SQLite read transaction。`view` 保存 sealed logical cutoff；detail request 用
短 connection 重开同一 immutable facts。

## `exp`

Host 在模型、Sandbox、provider 或付费调用前打开并验证 store revision。predecessor 返回
`record-schema-migration-required`，newer/foreign schema 返回 `record-schema-unsupported`；ordinary execution 不隐式维护。

writer append 的成功反馈只表示 command 已被 bounded mailbox 接纳。CLI 在结束 Run 前调用所有 Attempt completion fence：
它关闭新 admission、等待 backlog、拒绝未显式 close 的 active collection，并传播后台 storage failure。Run finalizer 随后在
transaction 外验证 closure，最终 transaction 原子写 Seal 并切换 `sealed`。只有 commit 后才输出成功 receipt。

其它 process 可以持续读取 sealed Run。write contention 在 deadline 内等待 ProjectDatabase 的 Host-only coordination-table ticket 与 SQLite lock，超时返回
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

命令先按 source bytes、可用空间与 deadline preflight，再短暂阻止新 write transaction、排空已经开始的
transaction 并执行 SQLite backup。source 固定后立即释放 barrier；producer backlog 继续。命令在独立 target 删除 unpublished
closure，`VACUUM INTO` sealed-only database，验证 exact Seal、checkpoint 并关闭，然后才发布 Snapshot receipt。

完整的成功 receipt、`record-snapshot-busy` 失败输出与 target 的发布边界见
[显式 migration 与 Snapshot 边界](use-case/显式迁移Record-major.md#snapshot-输出案例)。

## Migration 与 clean

`niceeval migrate` 先识别 storage revision 与 family revision。physical schema migration 使用 checked-in adjacent SQL；future v1 family/data
migration 使用 typed adjacent converter，不导入 0.13.x bytes。ordinary command 从不执行 Drizzle 或生成 SQL。大表 rebuild 使用 copy-on-write target，
验证成功才替换 source。

`niceeval clean` 只在 exclusive maintenance 下删除重验后仍为 `open` / `sealing` 的 rows。它不删除 sealed invalid facts，也不处理
UserDatabase 的 cache registry、credential reference 或 user state。

`migrate`、`clean` 的成功 receipt，以及 migration、database validation 与 maintenance conflict 的失败输出见
[显式 migration 与 Snapshot 边界](use-case/显式迁移Record-major.md#migrate-与-clean-输出案例)。

UserDatabase 的操作只经具名 feature Repository 进入 `${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite`。
central owner 在该 Repository 首次 operation 或显式 maintenance 中执行 lazy adjacent migration。
CLI 不接受 SQL、module、table 或 operation 注入。

Docker/E2B cache registry、Incus allocation/artifact ledger 与 user-level lease/coordination 不再保留为
`~/.local/state/niceeval/*.json` 的长期 registry。cache schema、cleanup 或业务错误只失败该 Repository。
它们不能成为其它 durable Repository 的逻辑前置。v1 不提供 raw UserDatabase portable backup。

v1 不兼容 0.13.x Record/state/cache bytes，也不提供 converter。新路径是唯一权威。发现旧 bytes 单独出现或与新路径并存时都 fail closed。
旧 cache 只由具名 maintenance 在没有活动使用者时删除。

## 输出案例

- Snapshot、`migrate`、`clean` 及其公开 maintenance 错误：
  [显式 migration 与 Snapshot 边界](use-case/显式迁移Record-major.md#snapshot-输出案例)。
- writer、collection 与 Run Seal 失败：
  [发布一轮完整 Run](use-case/发布完整运行.md#写入与封口失败输出)。
- bounded read、unknown family 与 Content admission：
  [多次 send 怎样收集 Attempt 事实](use-case/多次send怎样收集Attempt事实.md#bounded-read)。
- UserDatabase Repository maintenance：
  [选择正确的持久边界](use-case/未来功能不扩张核心格式.md#userdatabase-错误输出)。
