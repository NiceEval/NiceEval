# State —— Architecture

## Lineage

一条 State lineage 由 `(name, version, cohort, experimentId, evalGroupId)` 五项决定，隐含 authority 是同一个 ProjectDatabase。
lineage 有零个或一个 HEAD，每次成功保存建立 immutable checkpoint。相同 digest 不代表同一 checkpoint，CAS 比较 checkpointId，防止同内容的 ABA。

改 version、cohort、Experiment 或 Eval Group 名字会建立新 lineage，不迁移状态。paths 与 initialize 进入条件身份；路径布局改变必须改 version，旧归档不能静默适配新布局。
initialize 变化只影响无 HEAD 的新实例；已有 HEAD 时只恢复，不重新初始化。

## 存储

具名内部 State repository 拥有 lineage、checkpoint 与 State execution，复用 [ProjectDatabase](../run/architecture/storage.md)。不导出 SQL、通用 writer 或 provider registration。
完整表、键、索引与事务见 [Data Model](data-model.md)。checkpoint 字节以有界 chunk 存于同一数据库，避免文件 HEAD 与 Run 回执出现两个提交点。

同台实例的所有 binding 是一个提交集合。capture 在事务外完成，短事务只检查全部 predecessor、租约 generation 与 Run writer generation，再一次推进所有 HEAD 并发布 saved 事实。
事务失败则全部保持原 HEAD；commit 后 ack 丢失时按 executionId 重读同一事务结果，不重做初始化、capture 或保存。

无法重读时报告 unknown，不猜测未提交，也不释放自动租约。公开 recovery 先核对数据库结果；已提交保留 saved，确定未提交则发布 skipped/recovered。
读者始终只信任同一数据库 authority 内的 CAS。手工改表是损坏，不承诺不协作的写入仍受互斥保护。

## 生命周期位置

```text
atomically create Session and all Runs
  -> independently acquire this Experiment State/sharedState lease set
  -> Experiment before / Group before
  -> provider acquire
  -> publish State execution with frozen origins
  -> validate all paths and checkpoint manifests
  -> restore all bindings or initialize fresh roots
  -> publish restore ready
  -> selected resource materialize / verified workdir baseline
  -> each selected real Attempt
       -> reset workdir / resource prepare
       -> per-Attempt before / agent install / setup / test / teardown
       -> per-Attempt cleanup and after
  -> resource release
  -> verify all writers quiescent
  -> capture all bindings and atomically save
  -> provider finalizer
  -> Group after / Experiment after
  -> release leases, or retain cleanup-required
```

SandboxLayer 与 Plugin 的 before/after 始终逐 Attempt；没有隐式 physical promotion。
State 的 restore 与 save 是 Runner 内部物理阶段。初始化所需工具来自 template；逐 Attempt 的准备与缓存不能重置 State 路径。

绑定 State 的实例禁用 before cache capture/restore，避免整机缓存替换状态；声明式 before 仍真实执行。workdir reset 与资源 prepare 不得改 State 根。
Provider 必须支持安全文件树操作和全实例写入静默验证，否则规划拒绝。不把成功退出的 Agent 命令当作后台写入者已停止的证据。

## 恢复与保存

取得实例后先发布 execution 与起点，再校验所有根和归档 manifest；全部合法后才删除声明根、恢复或初始化。
新 lineage 没有 initialize 时建立空起点；缺失 blob、解码错误、不可读 HEAD 均是失败，不当作 fresh。
任一项恢复失败，整台实例不接 Attempt，不保存半初始化内容。恢复失败遵守 Group onUnavailable，替代实例重读未改变的 HEAD。

只在全部恢复成功、至少一个 Attempt 进入 Agent 阶段、所有阶段结束且写入静默后保存。Assertion failed 不使文件树失效；基础设施失败则禁止保存。
归档按 manifest 根编号与相对成员编码，保留缺席根；稳定排序，保存文件内容、目录与 mode。不保存宿主绝对路径作为解包指令。
只容忍 ENOENT；不可读、读取时变化、链接或异常类型都拒绝 capture，不能用 `tar --ignore-failed-read` 弱化错误。

全部 State 与 Group resource release 共用一个 30 秒收尾预算，不按 binding 累加。正常结束、timeout 与中断都使用独立 cleanup signal；独立 signal 不表示允许保存不可信状态。
正常轮换若满足保存条件可提交；故障替换先完成 skipped/failed 事实，再允许下一台实例恢复。

## 失败处理

| 阶段或条件 | State 结果 | 调度与退出 |
| --- | --- | --- |
| 路径、restore、initialize 失败 | restore failed，save skipped | 不派发；按 onUnavailable；非零 |
| `materialize`、`prepare`、`reset` 失败 | save skipped | 退休实例；按 onUnavailable；非零 |
| Agent 执行 timeout、取消或 Invocation interruption | save skipped | 按原取消策略；非零 |
| Agent 仅任务失败、Assertion failed | 满足静默条件时可 saved | 保留 Verdict 决定退出 |
| Attempt cleanup、resource release 失败 | save skipped | 停止本 Group；非零 |
| 没有实际 Agent 阶段 | save skipped/no-attempts | 不推进 HEAD；服从原调度退出状态 |
| 无法证明静默、Provider 失联 | save skipped | 停止 Group，保留租约；非零 |
| capture 或确定未提交的数据库失败 | save failed | 不推进 HEAD；非零 |
| predecessor 或 generation 不符 | save conflict 或 failed/owner-lost | 不推进 HEAD；非零 |
| commit 后读取不可用 | save unknown | 保留租约，恢复后重读；非零 |
| provider finalizer、Group/Experiment after 失败 | 已提交事实保留 | 不撤销 checkpoint；保留租约；非零 |

所有结果都不改写已发布 Attempt 的 Verdict。State 阶段失败计 execution error，不能因缺少 Attempt 而显示成功。
正常 early exit 或预算导致无派发时不造 Attempt，也不保存初始化结果；预算自身仍遵守原退出规则。

## 并发与恢复

State 与 sharedState 共用同一 ProjectDatabase 的租约 authority。跨数据库、跨复制项目或跨机器的同字符串不提供互斥。
每个 Experiment 单独把本次选择的全部 Group lineage 排序去重，key 为 `state/<sha256(canonical lineage JSON)>`；`state/` 是保留前缀，作者 sharedState.key 不得使用。

同一 Experiment 的 State 自动 keys 与其作者 sharedState.key 在一个短事务里全取或全不取。
集合在全部 Run 原子创建后持久化并绑定 exact runId，早于 Hook 与 Provider 创建；实体与恢复权限见 [租约集合](../experiments/data-model.md)。
不同 Experiment 不共用一个集合，各自持有 after 义务；取得集合即可独立执行与释放，不等待其它 Experiment 取得集合。等待不持有部分锁、Sandbox、dispatch 名额或 Eval lock；取消等待不遗留租约。
拿到全部租约后重新读取起点，dry 的观察值不构成预约。租约一直持有到全部 finalizer 与 Experiment after 结束。

正常确定失败且全部资源已静默时可以释放；unknown、cleanup 失败或无法证明远端静默时保留整个集合。
公开恢复复用 [Experiment recovery](../experiments/cli/README.md#协调等待与恢复)，按持久化的集合与 exact token/generation 恢复，不能只释放其中一个 key。
自动 State 集合使用 Runner 的恢复动作：确认原 owner 终止、远端静默后，核对保存事务，再释放集合。
执行事实的终结必须通过 [Run recovery actor](../run/architecture/lifecycle.md#崩溃与-recovery)，集合恢复自身不能在终态 Run 上追加事实。
作者声明了 sharedState.key 时仍必须运行其 after；纯自动 State 集合只有没有已登记 after 义务时允许缺少作者 after。失败保留集合，旧 token 不影响新 holder。

## 结果携带

State Attempt 永不自动 carry，也不接受 accept 或 rename 映射作为目标状态推进。拒绝使用 `state-adoption-unsupported`；历史固定 Run 与 Attempt 仍可读取。
当前结果适用性返回 `gap: stateful-input`，因为没有逐 Attempt checkpoint 能证明下一次执行起点相同；当前质量分母不借用历史分数。
真实执行仍服从 selected slice、预算、early exit 与取消，不补跑未选前缀。

binding 的完整定义、cohort 与 initialize action identity 进入条件身份。未绑定时不写 state 键，保持既有 digest。
执行次序与起点属于实际事实，不能通过更改条件摘要伪装成一次真实推进。

## Run 事实

[公开形状](library.md#结果形状) 是 Run Schema 与 Inspection 的单一声明。Run 发布保存每个 execution 的所有版本，按 PublicationCutoff 读取；旧 cutoff 不可见后来的 saved。
Attempt context 在发布时固定关联 executionId；保存与恢复只追加 execution 事实，不回写 Attempt。
恢复失败可以零 Attempt；故障替代保留每一代事实，不压成 lineage 的最后一次保存。

Run 关闭前，全部 execution 必须终结；进程崩溃后只有 Run recovery actor 在同一 authority 核对提交结果并终结 pending；集合恢复先调用它，再处理 after 与释放。
数据库不可读时不能伪造终态或发布完整 Run。unknown 是运行时反馈及可持久化的中间事实，恢复必须将其收敛为已提交或未提交。
portable record.sqlite 保留 execution、Attempt context 与保存回执；读取不访问原项目、Provider 或 checkpoint 内容。

## 存储生命周期

HEAD 与 checkpoint 属于项目运行状态，独立于 Run 删除；出处 runId 是历史标识，不建指向可删 Run 的外键。
portable Record 是同一个 canonical 文件，包含 checkpoint 字节；只读 `--record` 不授予执行 authority，也不访问 Sandbox。

只有作为项目 canonical ProjectDatabase 的写入口可以恢复执行；不新增导出、旁挂目录或第二份数据库。
复制整个已停机项目形成独立 authority，保留 checkpoint 但不跨副本协调；移动同一项目保留状态。新建数据库从空状态开始。
旧 checkpoint 不自动回收；Run delete 不清空它。跨项目迁移、merge、后台服务快照与独立 checkpoint 命令不在范围内。
UserDatabase 格式不符时拒绝打开，不提供迁移命令；清理规则见 [Sandbox 数据模型](../sandbox/data-model.md)。

## 验收

真实 Docker 的两题 Group 证明累积、再次运行恢复与换 cohort。加入真实逐 Attempt before，确认其保留记忆且禁用缓存恢复。
路径祖先、不同 State 重叠、symlink、归档越界与布局变更都必须在删除前失败，声明外 marker 不变。

两个 binding 中一项失败不得推进另一项。故障实例和替代实例都能经 `show` 关联各自 Attempt；零 Attempt 的恢复失败仍可审计。
在事务前、commit 后 ack 前终止 writer，再走公开 recovery；HEAD 与 saved 回执必须同成同败。两个同 authority 的 Invocation 验证全取租约与取消等待。

两个多 Experiment Invocation 以交叉顺序请求 x/y key，必须各自推进，不能等待成环。
在 Run 已创建但 execution 尚未建立时终止进程，恢复仍须收口 Run；纯 State 的旧 after 不得因当前声明改变而绕过集合恢复。

分别验证缺席与不可读路径、后台写入、收尾 timeout、Run delete 后继续恢复、portable Record 离线读取，以及 dry 之后 HEAD 变化。
验证 filtered slice、预算、early exit、禁止自动 carry/accept/rename、JSON 关联与非零退出。不用 fake 复制核心提交、文件安全或租约语义。
