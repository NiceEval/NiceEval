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
| exact Run | run resource 主键 | `run.get`、`show --run`、reuse source |
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
schema fingerprint 与 gate identity 写入 canonical metadata。它不自动删除 locks、sessions 或 coordination rows。新 baseline
从创建起强制 `PRAGMA secure_delete=ON`，每次 writer open 也必须验证它。

schema 拒绝 virtual table、external-content table 与未知 storage object。Host 随后关闭所有 writer、checkpoint 并 truncate WAL，
再以内建 hostile read-only 路径重开同一个文件。

重开必须验证 baseline、SQLite integrity、foreign key 与 publication closure。它还要验证 portable barrier、publication cutoff，
并确认没有 active Session、Run、case lock、recovery、未发布 aggregate 或其它 coordination 工作态。
任何步骤失败都不得把文件宣称为 portable。

成功后的 canonical 文件自身就是可移动 artifact，不生成 Snapshot、export、另一份 SQLite 或整库重写。下一次 Run create 在
同一事务中把 portable generation 切换为新的 `open` operational generation；从该 commit 起旧 portable receipt 不再代表当前
文件。运行中数据库可以被 Inspection 读取，但不得宣称 portable。

新格式使用唯一 format identity 与 schema fingerprint。不存在的路径通过 bootstrap transaction 创建；已有文件按精确格式识别。
Reader 在内部取得当前格式的已验证事实，具体输入选择规则见下文。未知版本和损坏文件拒绝读取，不执行 SQL fallback。

从 `--record` 打开的外部 SQLite 始终是 hostile import。输入必须是已经交付、无并发修改的单文件 portable Record。
source adapter 只以文件只读方式捕获到私有目录，不让 SQLite 打开原件，不修改原件或任何源 sidecar。
非空 WAL、journal、不支持的文件类型、无法检查的 sidecar 或捕获期间变化均拒绝；SHM 不参与数据拼装。
私有捕获经过精确格式、完整性、外键、portable 状态、owner 与 publication closure 验证后才可读取。
已知历史格式在私有副本中自动迁移；它不变成项目 canonical Record，也不获得执行或恢复权限。

## 自动迁移

正常项目写入口在接收新工作前，将已知 ProjectDatabase 格式升级到当前格式；不要求用户重新执行全部历史评估。
迁移只处理被当前 Host 明确拥有的项目数据库，不修改通过 `--record` 打开的外部文件。
格式识别同时验证版本、完整历史 schema、fingerprint 与数据，不接受仅改版本字符串的文件。
历史 schema 与转换器由内部 SQLite adapter 固定维护，不把迁移回调作为用户扩展 API。

`show`、`query`、`run list/show` 与 `view` 无需先执行评估即可读取支持的历史 portable Record。
读取不加载评估配置、不创建 Run，也不调用项目 writer。
项目输入没有 WAL、SHM 或 journal 时，先捕获私有副本，再按精确 schema 分流；没有 sidecar 不等于 portable。
当前格式不进入可写迁移，沿用项目 operational 读取语义；历史格式仍须证明 portable、idle 与 sealed 才可迁移。
捕获期间任何 sidecar 出现或原文件变化都拒绝，不自动切换读取机制。

项目输入存在 sidecar 时，使用当前格式的 operational SQLite 只读事务；View 从同一事务建立私有 generation。
此路径允许 SQLite 管理 SHM，但不写主库，不执行迁移、checkpoint 或 repair；历史格式、未知格式与待恢复状态拒绝。
sidecar 只选择读取机制，不证明格式或 portable 身份。

当前项目读取只验证 ready schema 与 migration 边界，不重新执行全库完整性、外键或全部 Run 验证；信任边界与读取成本见 [Inspection 架构](../../inspection/architecture.md#读取信任与成本)。
全量验证属于私有捕获、迁移、recovery、portable gate 与显式完整性维护。active 发布事实沿用既有项目读取语义，未发布 rows 不可见；
私有 generation 不因此获得 portable、执行或恢复资格。外部输入不使用此项目例外。

私有捕获在首字节写入前取得私有权限，并对固定文件描述符执行两遍有界读取、摘要和文件身份复核。
这些检查用于检测变化，不承诺对并发修改者提供原子快照。捕获、迁移和最终验证共享同一可终止 worker 期限。
成功 generation 由消费 Scope 持有；失败或取消先终止 worker，再删除私有数据库、备份和 sidecar。
Preview 从同一已验证 generation 取得 cutoff、计算摘要并打包，不重新复制历史原件。

迁移在同一个数据库 inode 的 SQLite 排他写事务中完成。新旧可写表名集合完全分离，包括 metadata 与协调表，不提供旧名 alias 或可写 view。
因此迁移前已经打开但尚未登记工作的旧连接也不能在提交后继续写；旧快照不能升级为新历史的 writer。
活动或无法确认已终止的资源 owner 阻止迁移；不根据 deadline 推测未知进程已经退出。

备份必须对应锁定后实际迁移的输入，并在提交前可靠保存。转换先校验旧事实，再按明确字段路径升级。
受影响的 payload digest、publication closure、seal entry 与 Run seal 一并更新；Run、Attempt、引用关系、判定和用户材料保持原义。
`flags` 与附件中的同名业务字段不转换；迁移不能靠全文替换 JSON 实现。

事务提交前失败时恢复完整旧状态。提交后 checkpoint 或重开失败保留已提交状态，给出可重试诊断，不用旧备份替换当前库。
只有当前格式与领域完整性校验通过后才接受新工作；尚未通过 portable 校验时不宣称可搬运。
重复进入当前格式不再次转换历史数据。

历史结果可读与执行沿用资格分离。迁移不重算历史 execution identity，也不补造新 policy 所需证据；缺少证据的结果重新执行。
未知版本、前 ProjectDatabase 布局、损坏文件或无法证明的字段转换明确拒绝，原文件保留。

## Record 格式版本历史

Record 格式版本独立于 npm 包版本，不能用产品版本号推断数据库格式。
当前 schema 独立定义；历史 schema 仅用于精确识别与迁移，不参与当前 schema 的生成。

| 格式版本 | Run execution 身份 | 升级 |
|---|---|---|
| `niceeval.project-database/0.15` | `agentId: string` | 映射到会话适配器身份 |
| `niceeval.project-database/0.16` | `application: ApplicationIdentity` | 按旧判别字段转换接入身份 |
| `niceeval.project-database/0.17` | `adapter: AdapterIdentity`，Hook 声明可缺失 | 保留 Core 字节，迁移至独立可写表 |
| `niceeval.project-database/0.18` | `adapter: AdapterIdentity` 与显式 Hook 声明 | 为每个 Run 建立 typed Experiment 身份与读取索引 |
| `niceeval.project-database/0.19` | 同 0.18 | 当前唯一写入格式 |

0.15 的 Agent 与 0.16 的 Agent 分支可由旧格式事实确定为 `contract: "niceeval.agent/v1"`，没有显式行为版本则保存 `null`。
0.16 的自定义应用分支保留原 name、contract 与 behaviorRevision，只改变其接入身份表示。

历史格式中的合法 `experimentHooks` 声明逐字段保留，Run 与 Attempt publication closure 使用同一转换。
声明缺失仍表示 unknown，迁移不补造 absent；非法版本、枚举值及其它未知字段拒绝。

0.18 → 0.19 不改变任何 Core、digest、seal 或 publication 字节，只做两件事：

- 从每个 Run 已验证的 Core 取出 `experimentId`，写入 Run 行自己的 typed `experiment_id` 列；已有 run resource 时两者必须相同，不同则拒绝迁移。
- 建立下文[读取索引](#读取索引)。

迁移不为缺少 run resource 的历史 Run 合成 resource、invocation、revision、expected Planned attempt 或 binding，也不推进 publication clock；这些 Run 的既有读取与 source barrier 语义保持不变。
0.19 使用独立 `ne19_` 可写表。

0.17 的 Core payload、digest 与 seal 保持原字节；0.18 使用独立 `ne18_` 可写表，移除旧 `ne_` 对象。
0.17 必须处于 ready；尚未完成的旧迁移保留现场并拒绝升级，先用原版本完成恢复。
备份按输入格式与目标格式分别命名，独立保留各迁移阶段的证据。

当前完整形状由 [Eval 架构](../../eval/architecture.md#应用契约与实现身份) 拥有。
这些确定转换不查询当前配置，不猜测当年的远端部署，也不把接口名称当作能力证明。

## 展示 Note 的持久化

`niceeval.attempt-note` family revision 1 随 Attempt publication 保存 Note 列表。
每项含 `label`、零起始且连续的 `sequence`、JSON `value` 与可选 `unit`；顺序与调用顺序一致。
它与 Assertions 分开保存，不参与 Verdict、score、coverage 或 Assertion 数量。
旧 Record 缺少该 family 时读取为空列表，不补造 Note。

## State 的持久事实与 portable gate

[State repository](../../state/data-model.md) 在同一 ProjectDatabase 保存 HEAD、checkpoint 字节与执行事实。
最终事务同时验证 Run writer generation、所有租约与 predecessor，并发布 saved；没有文件指针与数据库回执的双提交。

portable gate 还拒绝未终结 State execution、unknown commit、staging bytes 与未释放 State 租约。
回收 staging 后 canonical 文件本身仍是 portable artifact；checkpoint 随文件保留，不引入导出或旁挂文件。
Run delete 保留 lineage 与 checkpoint，只删除本 Run 的执行事实；严格外部 reader 只验证和读取，不取得执行权限。
