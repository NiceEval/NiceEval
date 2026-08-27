# State —— Cohort、Checkpoint 与预期持久化

## 要消除的 Frog / DX 摩擦

跨 Attempt 的记忆、数据库或目录常把 cohort、checkpoint、恢复位置和写回规则拆在不同 callback 中。
网络在提交途中断开时，调用者既不知道是否已写入，也无法安全决定下一步。以模糊位置恢复还会让两次
实验读到不同状态却被当作可比较结果。

State 将这些边界合并为 provider-owned cohort、region 与 exact checkpoint。一次 state execution 从一个
完整的预期 predecessor 开始，并以带 fence 的 compare-and-set commit 结束。

## 核心心智

`StateProvider` 是唯一能签发 `Cohort`、`StateRegionRef` 与 `StateCheckpointRef` 的 owner。每个公开
checkpoint ref 都穷尽 provider、namespace、cohort、schema、region 与 checkpoint 的 provider-issued identity；
它们不是作者填写的字符串。`StateRegionRef` 自身已绑定同一份 Cohort，因而不能把另一 cohort 的 Region 带入
同一条 execution。

State checkpoint 是 Cohort 内 immutable 的 exact 状态点。`StateCheckpointRef.contentDigest` 是公开的可比较
内容摘要字段：`comparable` 分支必须有它；`debug` 分支可以省略它。core 不能从路径、时间或可变指针推导替代值。

首次 `acquire(binding)` 时，provider 必须给出 content digest，并保证 CAS、同一 `commitId` 的 idempotency 与 fencing。
任一能力无法给出，或任一边界的 ref 缺少 digest，Runner 从该刻将整条 execution 固定为 `debug`；之后即使
provider 补齐能力或 digest，也绝不回到 `comparable`。

一次 execution 要么 fresh 起步，要么以一份 exact `StateCheckpointRef` restore。提交同时给出完整
`expectedPredecessor`、provider-issued fence 与 Runner mint 的幂等 `commitId`。provider 只有在 identity、
predecessor 和 fence 都匹配时才签发 new checkpoint。

作者在 Experiment 或 Trajectory 中绑定一个 `StateRegionRef`，就是显式声明该 Region 是预期跨 Attempt
保留的状态。Provider 同时为它签发物理持久边界：Sandbox 内状态使用 exact/subtree 虚拟路径，外部数据库等
使用同一 Region 的 external-resource surface。作者不另写可漂移的排除列表，也不能用字符串把任意目录标成状态。

## 范围

- provider-issued opaque Cohort、绑定 Cohort 的 Region、schema 与 exact checkpoint reference。
- `expectedPredecessor` compare-and-set、fencing、Runner-minted idempotent commit ID 与同 ID 对账。
- Run-owned state receipt、monotonic comparability、封闭 typed failure 与 Effect v4 `Scope.Scope` 生命周期。
- provider-issued 物理持久边界，以及 intentional / unexpected / unavailable 的污染分类。
- `niceeval exp` 的可见反馈；不增加独立 State 命令。

State 不提供通用键值库、文件复制 API、自动 merge、自动 retry 或模糊 checkpoint 选择。它也不替代
Experiment 的 `sharedState.key`；该 key 只保护完整外部状态生命周期。

## 预期持久状态与污染

只有已绑定 `StateRegionRef` 且落在其 provider-issued physical surface 内的变化，才称为
`intentional-state`。Sandbox isolation 观察到 surface 外的变化时，仍报告 `unexpected-mutation`；观察不完整时
报告 `classification-unavailable`，绝不根据前后 Verdict 序列猜“可能是复用污染”。

这项分类只解释变化归属，不改写其它 lifecycle 结果。State 内发生 access denied、restore/reset 失败、symlink
escape、隔离失败、cleanup failure 或 commit indeterminate 时，原 typed failure 与 receipt 必须原样保留。
`intentional-state` 不能把这些失败降级成 warning，也不能让不安全的实例继续复用。

## Owner 与身份

| 对象 | Owner | 身份规则 |
|---|---|---|
| `StateProvider` registration | provider | 不透明的 provider、namespace 与 schema handle；作者字符串不能冒充它 |
| `StateProviderIdentity` | provider | 完整且不可拆的 provider、namespace、Cohort 与 schema tuple |
| `Cohort` / `StateRegionRef` / `StateCheckpointRef` | provider | Region ref 穷尽 provider、namespace、cohort、schema 与 region；checkpoint ref 再加入 exact checkpoint 与可选 `contentDigest` |
| `StateExecutionId` / `StateCommitId` | Runner | 128-bit 随机值，不能由作者输入 |
| fence | provider | 与同一 Cohort / Region 的 lease epoch 绑定 |
| persistence boundary | StateProvider | 同一 Region、规范化 physical surfaces 与 boundary identity |
| state receipt | Evaluation producer | Run ID、slot ID、完整 predecessor、commit ID 与持久边界摘要 |

跨 provider identity 的 opaque value 不可比较，也不能被拿来 restore。provider 在 acquire、restore、commit 与
reconcile 都验证这份完整 identity，而不是只比较一个 checkpoint 字符串。

## Assertion 决策

本方向不新增 Assertion。真实公开 owner 是 `StateProvider` 与 state lifecycle：它们持有外部状态、精确
restore 和原子 commit。Eval Assertion 只判断任务事实，不能证明外部 commit 是否发生；Verdict 也不能代替
provider receipt。

生产可观察验收走真实 `restore → work → commit → reconcile → Scope finalizer` 生命周期、`niceeval exp`
的 human / JSON 反馈，以及两个竞争 writer 的 E2E。另一条真实 Sandbox 切片区分 Region 内预期状态、Region 外
变化和观察不完整，并验证它们不会遮蔽 access/reset/isolation failure。验证不以 fake 复制 CAS、idempotency 或
fencing 的核心语义。

## 失败与迁移边界

公开 failure 是 [Library](library.md) 中封闭的 typed union。它涵盖 acquire unavailable、cohort 或 checkpoint 不存在、
identity 或 digest mismatch、conflict、lease lost。其余成员是 transfer failed、commit indeterminate、timeout 与
interruption。
没有开放字符串错误码的逃生口。

公开面不接受无版本状态键、目录路径或按时间选取 checkpoint 的 selector。迁入 State 的调用必须取得 provider
签发的 Cohort、`StateRegionRef` 与 exact `StateCheckpointRef`；不能给出 exact value 时，只能 fresh 开始。
旧式无条件写回、last-writer-wins 与非幂等提交不保留翻译层。

## 入口

- [Library](library.md) —— opaque handle、Effect v4 service / Layer API、完整 reference 与 receipt 形状。
- [CLI](cli.md) —— 既有 `niceeval exp` 的输出与审计边界。
- [Architecture](architecture.md) —— 数据关系、CAS、fence、debug 与对账。
- [Lifecycle](lifecycle.md) —— Scope、restore、提交、失败与收尾时序。
- [Sandbox 生命周期](../../feature/sandbox/lifecycle.md) —— State restore 所处的物理 Sandbox 阶段。
