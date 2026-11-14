# Run Lifecycle

本页拥有 Run Host、Runner、Inspection 与内部持久 adapter 之间的跨 owner 顺序。

## 创建与执行

```text
Invocation starts
  → one transaction creates active Session + Runs + expected plannedAttempts + Run writer generations
  → each Experiment independently acquires its required leases
  → claim case locks at execution admission
  → publish origin/reference plannedAttempt bindings independently
  → close Run: terminal state + absence reasons
  → return InvocationReceipt at one PublicationCutoff
```

Run create 与 active Invocation Session 一旦共同提交就分别进入 `run list` 与 `session list`。
Attempt 可以分批进入内部 staging；只有 publication transaction 提交后才公开。

staging aggregate 与已发布事实位于同一个 canonical `.niceeval/record.sqlite`。两者由状态、writer generation 与 publication
revision 隔离，不得建立 per-Run、per-Attempt、Session 或 lock SQLite/sidecar。
长期持有的 case-lock 或 Session authority 不持有长 SQLite transaction；每次观察或 mutation 都以短事务重验 exact identity 与 generation。
Run close 不重新发布或撤销 Attempt，只冻结终态与剩余 absence reasons。

正常退出停止新的 reservation，等待已经接纳的 Attempt publication，再提交 Run close。

SIGINT 与 SIGTERM 走同一受控路径：发布已经完成的 Attempt，并把没有 publication 的 Planned attempt 以 `interrupted-before-publication` 收口。

普通 Adapter 的在途 Attempt 先停止 forward，在固定 cleanup 总预算内排空尾部采集，再把可验证的 `errored` Attempt 发布到仍活动的 Run。
Runner 等待这次 publication 后恢复中断，停止后续派发，再提交 Run 终态。封口或存储失败仍按 Run 失败与 absence 规则处理，不伪造已发布结果。

它返回 `interrupted` receipt，并在同一收尾路径把 Session 收口为 durable Invocation projection。
随后关闭 writer、checkpoint 并 truncate WAL，再以内建只读路径重开 canonical database。
只有 schema、引用闭包、publication 和领域不变量验证全部通过，CLI 才成功交付 receipt 与 portable Record。

## 材料 receiver 与 Judge 封存

Attempt 创建时先建立 Assertion runtime、统计 owner 与 Judge collector，但 application receiver 尚未开放。
create 正常返回后，先重验 Attempt 仍开放，再创建 guarded app 与 receiver。
assertions factory 只装配同步方法，此时 app 访问与材料读取均被 guard 拒绝。
方法与返回对象全部校验通过后一次开放 app/receiver，再交付 Eval facade 开始 test；失败则关闭 receiver，不留下部分开放能力。

取消先关闭作者登记和全部 receiver，再中止受管模型，资源沿既有独立 cleanup 阶段释放。
create 在取消后迟到返回仍承担 Adapter cleanup 义务，但不组装 Eval facade、不安装 ctx，也不重开 reader。
Agent receiver 同样在自身 facade 就绪后开放，并在 Attempt 取消时统一关闭。
完整材料与临时预留按 [Evidence 结算规则](../../assertions/architecture/evidence.md#材料预留与封口收据) 处理。

Judge collector 在应用 create 前创建；新的已执行 Attempt 即使 create 失败也封存完整空账本。
未执行或跳过的计划 Attempt 不虚构 collector。root、Session 与 Turn 使用同一 Attempt owner，应用用量仍保持独立。

Attempt 终止先关闭所有 entry admission 与打开的传输 capability，再触发 abort。
在既有有界释放期限内收拢 transport 资源后冻结账本；同次 Assertions 预发布结果将 entryIndex 绑定为正式 entryId。
Assertions 与 Judge 附件在同一 Attempt publication closure 中提交；费用完整性不依赖 QA 判定或审计正文是否可读。
传输的首次回执截止、entry 局部超时和释放上限由 [Judge 生命周期](../../judge/architecture.md#judge-传输生命周期) 拥有。

## 崩溃与 recovery

SIGKILL 可能在 ProjectDatabase 中留下 `active` Run 与未发布 aggregate，但不会产生半个公开 Attempt。普通读取继续展示
Run、已发布 Attempt 与 pending Planned attempts，不根据时间推断 owner 已死，也不在打开时删除或晋升运行中 rows。

`run recover` 必须取得精确 process identity 已终止的可验证证据。
writer 在取得 generation 时封存自己的 process identity；recover 在同一台机器上重新观察同样的字段。
Linux 与 Darwin 是提供这种证据的平台，两者使用同一判定规则，只是取证位置不同：

| 字段 | Linux | Darwin |
|---|---|---|
| 机器身份 | `/etc/machine-id` | IOPlatformUUID |
| 启动身份 | `/proc/sys/kernel/random/boot_id` | `kern.bootsessionuuid` |
| 进程隔离域 | `/proc/self/ns/pid` | 无，固定为整机 |
| 进程启动时刻 | `/proc/<pid>/stat` 的 starttime | 内核保存的进程启动时刻，精度至少到秒 |

判定按字段顺序进行：

- 机器身份或进程隔离域不同：`unproven`，不能在别的机器上判定 owner 生死。
- 启动身份不同：旧 owner 随上一次启动终止，判为 `terminated`。
- 同一次启动内，pid 对应进程的启动时刻与封存值相同：`active`，recover 以 `run-owner-active` 拒绝。
- 同一次启动内，pid 不存在或启动时刻不同：`terminated`。
- 任一字段取证失败，或运行在其它平台：`unproven`，recover 以 `run-owner-termination-unproven` 拒绝。

启动时刻只有秒级精度时，pid 在同一秒内被复用会被判为 `active`。这个误判只会拒绝恢复，不会接管仍在运行的 owner，因此可以接受。

它以两阶段、可重试的 `active → recovering → interrupted` 收口。
第一笔短事务 fence owner generation 并写入精确 recovery actor。第二笔短事务在 actor/generation 仍匹配时删除仅属该 owner 的未发布 aggregate。
第二笔事务也写 recovery receipt，并把 Run 与 pending-Planned attempt absence reasons 共同收口。
绑定 State 时，这笔事务先按 [State 事实终结](../../experiments/data-model.md#状态事实终结) 对账并终结全部 execution，再写同一 cutoff 的 Run 终态。
集合 recovery 必须调用这个 Run recovery actor；Run recovery 不释放 State 租约，也不执行 Experiment after。

任一步崩溃留下 `recovering`，只能由新的精确 recovery actor 重试，不能把它猜回 active 或 free。证据不足时 fail closed；没有 TTL、heartbeat expiry 或“看起来很久”接管。

旧 generation 无论迟到多久都不能发布 Attempt。所有终态也拒绝任何 generation 的新写入。recovery 是领域状态收口，
不会删除 Run 或 Attempt。

## 删除与 retention

`run delete` 只处理已收口 Run。
若其 State 租约集合仍为 active 或 recovering，以 `run-state-recovery-required` 拒绝；先完成集合恢复，避免删除对账所需事实。它与 reference binding 串行化，事务内检查 incoming references 并发布 tombstone。
存在依赖时零删除；用户需要先显式删除依赖 Run。

删除在 canonical `.niceeval/record.sqlite` 的一个事务中验证引用、删除可删 rows 并发布 tombstone。
事务前 crash 不改变事实；事务提交后，新的 PublicationCutoff 不再读取该 Run。删除不产生另一份 SQLite。

Record open 只接受当前格式标记与精确 schema。旧格式明确拒绝，保留原件并提示重跑或删除存储。
未知格式、损坏数据或无法证明安全的旧 locks / sessions 均拒绝打开并保留原件，不尝试迁移或自动清空。
checkpoint、空间回收、generation lease 与 staging GC 都由内部 adapter 管理，不形成 maintenance 命令。
