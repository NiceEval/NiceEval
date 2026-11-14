# Run 架构

Run Core 拥有 Run、expected Planned attempt、Planned attempt binding、Attempt publication、Run state 与 deletion tombstone。
Experiment 拥有计划、absence reason 与复用资格；Inspection 拥有固定 cutoff 下的读取和聚合。SQLite adapter
实现事务与持久化，但不进入公开领域 API。
物理分块、command 重试、短事务与公平写入由 [SQLite 存储与资源生命周期](storage.md) 定义。

## Canonical Record 与运行中状态

每个项目只有一个 canonical `.niceeval/record.sqlite`。
Run create、运行中的 Attempt aggregate、Attachment、Content、case lock 与 Invocation Session 都写入这一份 ProjectDatabase。
teardown obligation、Run close、recovery 与 deletion 也写入这一份 ProjectDatabase。

产品与内部 adapter 都不得为 Run、Attempt、publication 或 Coordination 建立第二份 SQLite、sidecar 或逐文件锁。
中间态由行状态、Run writer generation 与 project barrier 隔离，不由文件边界隔离。

未发布 aggregate 的所有可变行都携带 `runId`、`attemptId` 与 `writerGeneration`。每次 mutation 在数据库事务内验证 project
barrier 为 `open`、Run 为 `active`、generation 匹配，并要求 Attempt 为 `staging` 或 `sealing`。任一条件不符都返回具名失败；
published aggregate 在数据库层不可再写。Inspection、reuse、Run show/list 与 reference lookup 只能从 cutoff 内的
publication/binding 读取 closure。未发布、sealing、旧 generation 遗留或晚于 cutoff 的 rows 都不可见。

operational mutation sequence 与 publication revision 分离。staging append 不推进公开 revision；Run create、Attempt
publication、reference binding、Run close/recover 与 deletion 才推进 publication clock。崩溃留下的运行中 rows 是明确的
operational state，不会因存在于 canonical database 就成为公开事实。

## 身份与固定计划

`runId` 与 `attemptId` 是全局唯一且不可变的领域身份。`slotId` 只标识一个 Run 在创建时冻结的 expected
位置，不能充当 Attempt identity。

Invocation start transaction 同时提交 Invocation Session、完整 target Run、expected Planned attempts、`invocationId` 与初始 `active` state。
它也提交 Run writer generation 与 publication revision。未提交的候选 Session 或 Run 不存在。
case-lock identity/generation 在执行准入时以独立短事务取得；需要 Experiment 租约时先通过其门禁，等待租约不持有 case lock。

Session 是 Invocation 的唯一 durable projection。终态 Session 与 `createdRunIds`、completion、cutoff 一起留在 portable Record，
而 live feedback 仍只属于当前进程。

一次 execution reservation 可以在内部取得 candidate attempt identity，但 publication 前不进入 list、locator、
Inspection 或 reuse。失败后的重试创建新的 attempt identity。

## 实验 Hook 声明

Run Context 的 `execution.experimentHooks` 保存 producer 在 Plugin composition 后捕获的声明输入：
`{ version: 1, setup: "absent" | "opaque", teardown: "absent" | "opaque" }`。
普通执行与 reference Run 都从各自已冻结的 effective Experiment 输入构造这项事实，不执行 callback 来探测。

这项声明不证明 callback 等价，也不代替 execution identity。字段缺失表示历史没有提供该事实，不能解释为 absent。
Run Core 只保存声明；Experiment policy 决定它是否足以支持[改名采用](../../experiments/cli/rename.md)。
声明不进入既有 fingerprint 或 configHash，不改写历史 identity 字节。

## Attempt publication

origin publication 是一个短事务。它必须同时：

1. 验证 Run 仍为 `active`、writer generation 匹配且 Planned attempt 为空；
2. 提交 immutable Attempt closure 与 `AttemptPublicationIdentity`；
3. 写入该 Planned attempt 的 origin binding；
4. 取得单调 publication revision。

事务前先在短事务中增量写入 aggregate，并在事务外流式形成 closure manifest 与 digest。

publication transaction 验证 Run 仍为 `active`、writer generation 匹配、Attempt 为 `sealing`、manifest 与引用闭包完整、
Planned attempt 为空。随后一次 `BEGIN IMMEDIATE` 冻结 aggregate、提交 `AttemptPublicationIdentity` 与 origin binding，
并取得同一个 revision。
该 revision 同时进入项目级 publication cutoff；Inspection 不需要等待 Run teardown，便可在固定 cutoff 下读取完整 closure。

事务前崩溃时公开结果没有该 Attempt；提交后崩溃时公开结果完整包含它。迟到 append、旧 generation、重复 publish 与 command
retry 都不能修改已发布 closure。

carry 与 accept 不复制 Attempt。reference binding transaction 只允许引用已经发布、且通过当次 policy 资格检查的
Attempt。该事务在目标空 Planned attempt 原子写入 `{ attemptId, originRunId, originSlotId, publicationIdentity, action }`。
origin publication 与 reference binding 竞争同一个 Planned attempt CAS，恰有一个可以成功。origin Run 是否已经收口不改变
Attempt identity；即使 origin Run 仍为 `active`，已发布 Attempt 也可以被引用。

## Run 收口与 absence

`expected` 始终是 Run create 时的完整逻辑计划，也是 coverage 分母。`published` 表示 cutoff 前已经绑定到可读
Attempt 的 Planned attempt，origin 与 reference 都计入；`missing = expected - published`，永不补零或伪造失败 Attempt。

`active` Run 的 missing Planned attempt 统一显示为 `pending`。Run close transaction 原子提交终态与所有剩余 Planned attempt 的
`absenceReason`，两者取得同一 publication revision。终态永久拒绝任何新 binding。

Experiment 定义的 absence reason 闭集为：

```ts
type RunAbsenceReason =
  | "early-exit-satisfied"
  | "budget-exhausted"
  | "stopped-by-failure"
  | "interrupted-before-publication"
  | "dispatch-failed";
```

`early-exit-satisfied` 表示按策略完成，不构成结果缺口。其它 reason 保留自己的 incomplete 或 error 含义。
Pass/Score 指标只以已发布且相应指标 available 的 Attempt 为指标分母；coverage 始终同时交付
`published / expected`。

## PublicationCutoff

Run create、每次 origin/reference binding、Run close 与 Run deletion 都取得单调 commit revision。公开事实以
append-only event 或等价的可版本化表示保存，必须能按以下边界重建：

```ts
interface PublicationCutoff {
  readonly storeGeneration: string;
  readonly revision: number;
}
```

cutoff 只由这两个字段构成，固定它只读 publication clock 一行，不统计 Run 数，也不扫描历史 Run。
Inspection 在开始时固定一个 cutoff，只读取 revision 不大于该值的事实。晚于 cutoff 创建的 Run 不存在；晚于
cutoff 的 binding 仍为 pending；晚于 cutoff 的 close 不会让旧结果提前看到终态。continuation token 与 View
generation 都绑定同一 cutoff；无法在当前 generation 继续时返回 restart-required。

## 读取索引

每条读取路径都由身份索引定位，成本随请求涉及的 Run、Planned attempt 与事实增长，不随无关 Run 数增长。
当前格式必须提供以下访问路径：

| 读取 | 访问路径 | 使用者 |
|---|---|---|
| 固定 cutoff | publication clock 单行 | 全部 Inspection 与 reuse planning |
| exact Run | run resource 主键 | `run.get`、`show run:<run-id>`、reuse source |
| exact locator | `(attempt_locator, origin_run_id, attempt_id)` | Attempt operation、显式采用 |
| Experiment 的 Run | Run 行的 `(experiment_id, run_id)` | `experiment.get` |
| Experiment 的 source 候选 | run resource 的 `(experiment_id, created_revision, run_id)` | reuse source barrier |
| 逻辑位置的最近 Run | expected Planned attempt 的 `(eval_id, attempt_ordinal, run_id)`，与上一行联用 | reuse source barrier |
| 全量 Run 列表 | `(created_revision, run_id)` | `run.list`、当前 Results |

每个 Run 行都有 typed `experiment_id`；读取不按 Core JSON 回退筛选。没有 run resource 的历史 Run 只经 Run 行索引被发现。
索引只保存身份与可见性，不保存 Inspection result、聚合指标或 policy 判断。

## 删除不变量

Run 只拥有自己的 origin Attempts，不拥有引用来的 Attempt。删除只接受 exact 终态 Run；`active` Run 必须先经
有证据的 recovery 收口。delete 与 reference binding 共用序列化边界，并在事务内重验目标 Run 与所有 origin
Attempts 的 incoming references。

reference 先提交时，delete 拒绝并列出依赖 Run 与 AttemptLocator；delete 先提交时，后续 binding 返回
`source-run-deleted`。删除 reference-only binding 不影响 origin Attempt。v1 不提供 force 或 cascade。

成功删除在 canonical SQLite 的一个事务中移除该 Run 的可删 rows，并发布带 revision 的 deletion tombstone。
事务回滚时公开事实不变；提交后新 cutoff 不再看到该 Run 或其 origin Attempts。删除始终保持 reference 检查的线性化边界，
不建立 private database、不替换 canonical 文件。

## Portable gate 与不可信输入

ProjectDatabase 有 `open`、`draining` 与 `portable` barrier state。所有 writer mutation 在事务内验证 barrier。
portable gate 只由 Invocation 收尾以 project-wide CAS 从 `open` 进入 `draining`。它完整拒绝 active Session、Run、case lock、
recovery 与未完成 writer work。它不会等待、猜死、替其它 Invocation 收口或删除其 rows。

存在活动工作时 fail closed。已终止 owner 必须先走精确 process identity 的可重试 recovery。gate 或 recovery 崩溃后保留可精确恢复的状态，
不得按 TTL、PID 或启动时自动解锁。

gate 只删除正在收尾的 Invocation 已经证明属于自己的未发布 aggregate，并把其终态 Session、portable generation、cutoff、
格式标记与 gate identity 写入 canonical metadata。它不自动删除 locks、sessions 或 coordination rows。新 baseline
从创建起强制 `PRAGMA secure_delete=ON`，每次 writer open 也必须验证它。

schema 拒绝 virtual table、external-content table 与未知 storage object。Host 随后关闭所有 writer、checkpoint 并 truncate WAL，
再以内建 hostile read-only 路径重开同一个文件。

重开必须验证 baseline、SQLite integrity、foreign key 与 publication closure。它还要验证 portable barrier、publication cutoff，
并确认没有 active Session、Run、case lock、recovery、未发布 aggregate 或其它 coordination 工作态。
任何步骤失败都不得把文件宣称为 portable。

成功后的 canonical 文件自身就是可移动 artifact，不生成 Snapshot、export、另一份 SQLite 或整库重写。下一次 Run create 在
同一事务中把 portable generation 切换为新的 `open` operational generation；从该 commit 起旧 portable receipt 不再代表当前
文件。运行中数据库可以被 Inspection 读取，但不得宣称 portable。

新格式使用唯一格式标记与精确 schema。不存在的路径通过 bootstrap transaction 创建；已有文件按精确格式识别。
Reader 在内部取得当前格式的已验证事实，具体输入选择规则见下文。未知版本和损坏文件拒绝读取，不执行 SQL fallback。

从 `--record` 打开的外部 SQLite 始终是 hostile import。输入必须是已经交付、无并发修改的单文件 portable Record。
source adapter 只以文件只读方式捕获到私有目录，不让 SQLite 打开原件，不修改原件或任何源 sidecar。
非空 WAL、journal、不支持的文件类型、无法检查的 sidecar 或捕获期间变化均拒绝；SHM 不参与数据拼装。
私有捕获经过精确格式、完整性、外键、portable 状态、owner 与 publication closure 验证后才可读取。
旧格式在私有副本中同样拒绝，不获得执行或恢复权限。

## 格式准入

整个 Record 只有存储本身的一个格式标记。reader、writer 与 maintenance 在读取事实或执行写入前核对它。
标记不符时明确说明数据由旧版 NiceEval 写入，需要重跑或删除该存储；原文件保持不变。
不存在的路径通过原子 bootstrap transaction 初始化；并发创建者只能接受完整提交的当前 schema。

当前 schema、owner、Content、引用与 publication closure 仍逐项校验。格式标记不能代替完整性校验。
官方 family 不各自声明 persistence revision 或 schemaVersion；第三方 persistence 保留自己的独立契约。
不提供历史 baseline、兼容 decoder、备份、迁移链或迁移命令。

## 展示 Note 的持久化

`niceeval.attempt-note` family 随 Attempt publication 保存 Note 列表。
每项含 `label`、零起始且连续的 `sequence`、JSON `value` 与可选 `unit`；顺序与调用顺序一致。
它与 Assertions 分开保存，不参与 Verdict、score、coverage 或 Assertion 数量。
旧 Record 缺少该 family 时读取为空列表，不补造 Note。

## State 的持久事实与 portable gate

[State repository](../../state/data-model.md) 在同一 ProjectDatabase 保存 HEAD、checkpoint 字节与执行事实。
最终事务同时验证 Run writer generation、所有租约与 predecessor，并发布 saved；没有文件指针与数据库回执的双提交。

portable gate 还拒绝未终结 State execution、unknown commit、staging bytes 与未释放 State 租约。
回收 staging 后 canonical 文件本身仍是 portable artifact；checkpoint 随文件保留，不引入导出或旁挂文件。
Run delete 保留 lineage 与 checkpoint，只删除本 Run 的执行事实；严格外部 reader 只验证和读取，不取得执行权限。
