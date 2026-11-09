# Experiment —— State 租约集合

本页扩展 [sharedState authority](architecture/README.md#并发-invocation)，只用于绑定 Sandbox State 的 Experiment。
不绑定 State 的单 key 生命周期保持该 owner 的规则；本页不建立跨 ProjectDatabase 的协调服务。

## 归属与实体

一个集合归属一个 `(invocationId, experimentId)`，成员是这个 Experiment 所选全部 Group 的自动 State keys，加上它可选的作者 sharedState.key。
多 Experiment Invocation 逐 Experiment 取得集合；不会让 A 的 after 处理 B 的义务。成员在取得后不可增加或移除。

Invocation 先原子创建 Session 与全部 Run，再由每个 Experiment 独立取得自己的集合。
取得全部 key 与建立集合、成员在同一个短事务提交，早于 Experiment before 与 Provider 创建。
已取得集合的 Experiment 立即可以执行、收尾和释放，不等待其它 Experiment 取得集合，避免跨集合等待成环。
集合不依赖 State execution 才能存在；Provider acquire 前崩溃也能从任一 key 的 evidence 精确找到集合。

| 表 | 列与约束 |
| --- | --- |
| `state_lease_set` | `id TEXT PRIMARY KEY`；`invocation_id, experiment_id, run_id, owner_token, owner_evidence_json TEXT NOT NULL`；`generation INTEGER NOT NULL`；`phase TEXT NOT NULL`；`recovery_id, recovery_actor_json, after_registration_id TEXT NULL`；`after_status TEXT NOT NULL`；UNIQUE(invocation_id, experiment_id)；UNIQUE(owner_token)；UNIQUE(after_registration_id) |
| `state_lease_member` | `set_id TEXT NOT NULL REFERENCES state_lease_set(id)`；`key TEXT NOT NULL`；`acquired_generation, current_generation INTEGER NOT NULL`；PRIMARY KEY(set_id, key) |

generation 是正 safe integer。phase 只允许 active、recovering、free；after_status 只允许 not-required、pending、running、completed。
recovery_id 与 recovery_actor_json 同空同有；只有 recovering 可非空。free 不再持有 key，但保留 immutable owner evidence 和成员供旧 token 幂等核对。

owner_evidence_json 严格为既有 `{ experimentId, host, pid, processIdentity }`，experimentId 必须等于列值。
actor 使用同一 process identity 形状与随机 recoveryId；不能只靠 PID、heartbeat 或年龄判死。
集合 ID 与 owner token 均是随机 128-bit hex，token 只在既有显式 owner inspection 中显示。

既有单 key immutable generation/head 增加可空 `leaseSetId`：非空时指向集合，所有转移只能由集合事务完成。
成员的 acquired_generation 固定首次取得值；current_generation 等于 key 当前 generation。旧的 per-key immutable 链仍保留完整前代验证，不另建第二套锁。
索引 `state_lease_member(key, current_generation)` 用于 evidence 查找；当前 holder 的唯一性仍由既有 key head 主键保证。

`after_registration_id` 指向既有 exact after 义务身份，最多在 before 时点进入时由 null 设定一次；其内容仍由原 owner 保存。
取得集合时 after_status 为 not-required。登记 after 义务的同一事务设为 pending；没有到达 before 时点的崩溃不补造 after 义务。

集合取得事务绑定已存在的精确 runId，并核对其非终态及冻结的 Invocation/Experiment；run_id 不可为空或修改，不从当前配置或模糊查询补认。
State execution 的 lease_set_id 外键指向本集合，run_id 必须属于同一 Invocation/Experiment。
保留集合直到没有 execution 或未完成义务引用它；不能按时间删除。Run delete 不删除仍被 key evidence 使用的集合。

## 取得与正常释放

一次事务检查全部 key free；有任一 busy 则零修改、零部分持锁。成功时建立集合并把所有 key 推进 active，写入同一 owner_token 与 leaseSetId。
事务内核对所有前代；current_generation 写各 key 的真实新 generation，不要求不同 key 的数值相同。
等待集合不持有 case lock、dispatch worker、global 并发名额或 Provider lane；取消等待不留下集合。
集合取得前崩溃由普通 Run recovery 收口，不补造集合或 after 义务。
State key 使用保留的 `state/` 前缀；作者不能声明该前缀。

正常释放在全部 State 保存结果确定、Provider finalizer 与 after 成功后进行；事务校验集合 generation/token 与全部成员 current_generation。
一次推进所有 key 为 free、集合 phase 为 free、generation 加一。原 owner 迟到释放不能影响任何新集合。
unknown、未静默或 cleanup 失败保留整个集合，不能只释放已完成的 Group key。

## 显式恢复

CLI 用任一 key 的当前 immutable evidence 得到 leaseSetId，再验证用户 token 等于集合 owner_token；不按 PID、Experiment 或当前配置扫描成员。
selector 必须唯一匹配集合的 Experiment。静默双确认、原 owner 的终止证据与 exact token 全部通过后，一次事务 fence 全部 key 与集合 generation，并登记 recovery actor。

恢复顺序固定：

1. 对集合 run_id 指向的非终态 Run 调用正式 Run recovery；它先 fence Run writer，核对 State 保存事务并终结 execution，再关闭 Run。
2. 零 execution 只表示 State 对账为空，非终态 Run 仍须恢复并关闭 pending Planned attempts。已有 terminal Run 只核对终态事实，不追加新事实。
   active/recovering 集合指向的 Run 缺失视为损坏并拒绝继续，不能跳过或创建虚构 Run。
3. 只处理 after_registration_id 指向的那一条义务。纯自动集合没有登记时可直接继续；有 pending 登记时要求当前 target 的 after 函数。
4. after 成功后原子删除精确登记并置 completed，再以 exact actor/generation 释放整个集合。删除或提交失败都保留 recovering。

混有作者 sharedState 的集合仍遵守既有 after 要求，不能因为含 State 而跳过作者补偿。纯自动集合仅在没有已登记 after 义务时允许 target 无 after。
recovery 在 after 运行中崩溃时保留 running；新 actor 证明旧 actor 终止并取得新 generation 后重新执行同一补偿义务，要求 after 可安全重试，不承诺 exactly once。

新 actor 的接管在一个事务校验整个集合前代并推进全部成员；任何 key 已属其它 holder 就拒绝，不能释放子集。
原 token 已 free 时只读核对，不重跑 after。只有属于同一集合的已完成精确登记可幂等删除，无法证明时拒绝。

Run recovery 可以先单独调用：它只收口 Run，不释放集合或执行 after。随后集合 recovery 读取已终结 Run，继续补偿与释放。
集合 recovery 先调用时使用同一 Run recovery 入口；以后对已 terminal Run 的显式 run recovery 仍按原规则拒绝。
两个 recovery actor 并发时由各自 exact generation CAS 串行；不得直接写终态 Run 来绕过领域入口。

## 状态事实终结

Run recovery 的第二笔事务同时核对每个 execution 的保存事实并关闭 Run：

- saved 必须与同事务已提交 checkpoint 相符；保留 saved 与 ready。
- restore 为 pending 时改 failed/recovered，save 改 skipped/recovered；ready 或 failed 保留，未终结 save 改 skipped/recovered。
- 已有确定的 skipped、failed 或 conflict 保留；unknown 重读为 saved 或确定未提交后的 skipped/recovered。

全部新增版本使用 recovery actor/generation 与同一 publication sequence；终态 Run 不再追加 State 版本。
数据库不可读或无法证明原提交时保持 recovering 并非零退出，不能发布完整终态。集合继续持有，等待同一公开恢复重试。
