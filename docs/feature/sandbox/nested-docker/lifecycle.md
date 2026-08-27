# Nested Docker —— Lifecycle

V1 是 DestroyOnly。
每条 Attempt 使用一台一次性 Incus VM；成功、失败、中断与强杀后都销毁 instance、disk、network 与 lease。
`--keep-sandbox` 与 `sandboxReuse` 在创建资源前失败。

## Pre-dispatch planning and prepare

```text
discover Eval and Experiment
  -> select the single SandboxTemplate
  -> collect DockerExecutionRequirement
  -> Incus planner returns capability receipt
  -> compare requirement / capability
  -> compute BuildKey, CaseKey and SetupPrefixKey
  -> judge/config precheck
  -> compile each occurrence's continuous eligible serializable action prefix
  -> Run-level prepare coordinator looks up or completes the artifact
  -> reserve Provider capacity and dispatch Attempt
```

judge/config precheck 后、模型 session、Agent、hidden input 与 Attempt 之前，Runner 按既有唯一
`SetupPrefixKey` 编译连续 eligible serializable actions。callback、hook、plugin、`onCleanup()`、credential、
lease、Agent layer 与 hidden input 都是硬 barrier：它们真实执行，且不让其后的 action 加入共享捕获。

Run 级 prepare coordinator 查找或补齐 artifact；capacity 为 1 时必须先完成全部 prepare，再开始任一 Attempt。
prepare 不取得模型 credential、不运行 Agent、也不接收 hidden input。capability、capacity 或 prepare 不能满足时，
尚未创建 Sandbox、模型 session 或 Attempt execution。
排队等待 capacity 的成员显示 provider-capacity reason，不占已经执行中的 Attempt 位。

`--dry` 与正常运行消费同一份比较结果。
`acceptDevelopmentDomain` 已进入 identity，dry run 必须显示它。

## Create 与 ready

1. control plane 写入 `reserved` allocation 与 generation。
2. 写入 `creating` intent，以 allocation id 作为 Provider idempotency key 调用 create / clone。
3. Provider 回读 object metadata；NiceEval 提交 locator。
4. guest init mount root、workspace 与专用 Docker data disk，启动普通 dockerd。
5. readiness 以 `node` uid 1000 运行 `docker info`；需要 Compose 时再运行 `docker compose version`。
6. readiness 核对默认 Unix socket、无宿主 endpoint、quota 与空 private runtime state。
7. allocation 进入 `ready`，Sandbox 才交给 before action、Agent 与 Eval test。

create 返回 acceptance unknown 时，adapter 用 idempotency key 和 inventory 查询。
找不到对象且 Provider 明确返回 never-accepted 才能重发；无法确定时保持 intent 并停止该 Provider 新 admission。

## 普通收尾

1. Agent runtime teardown，并 fence 新 command。
2. 执行已登记的 after / cleanup，停止 Attempt 创建的 Compose project。
3. guest 回报 Docker container、volume、network、builder 与 session inventory。
4. NiceEval 把 allocation 写成 `destroy-requested`。
5. Provider 原子销毁 instance、private disks、network 与 ephemeral locator。
6. inspect 返回 absent 后提交 `destroyed`，释放 reservation。

NiceEval 不要求先清空 private Docker data 才允许 Provider delete。
删除整份私有 allocation 本身就是隔离证明。
guest inventory 只服务诊断和发现 Provider delete 漏项。

## `SIGKILL` 与控制进程重启

新 control process 取得 execution-domain leadership 后，先 fence 旧 generation，再枚举 ledger 与 Provider inventory。
所有 `creating`、`ready`、`handed-off` 与 `destroy-requested` allocation 进入对账。

已经到达 Agent turn 的 Attempt 标记 `environment incomplete`。
系统不会从仍存活的 VM 继续 Agent，也不会自动重新发送模型输入。
reconciler 对 exact Provider object 执行 detached destroy，并在 absent receipt 后释放 capacity。
即使 operator 已先删除 exact instance 与 volume，reconciler 也必须让仍占容量的 intent 经过
`destroy-requested` 再提交 `destroyed`；不能为 absent object 绕过 repository 的 fenced destroy 状态机。

## 宿主重启

Provider 先恢复自己的 durable instance / storage inventory，NiceEval 再开始 reconcile。
NiceEval 不在 activation 中重建 Provider mount tree，也不把旧 pathname 扫描成 allocation。
所有上次在飞 allocation 遵循 DestroyOnly。
committed Provider artifact 保持 immutable，可供新的 Invocation clone。

## Artifact capture, publication and reconcile

prepare worker 取得独立 allocation 并执行 eligible SetupPrefix。
成功后进入 quiesce barrier；任何进程、secret、外部 lease 或 state-surface 证明失败都取消 publication 并销毁 prepare allocation。

Provider 创建 stopped immutable template instance 及其 dependent custom block Docker data volume；两者先以
同一 `ArtifactIntent` 写入准备中的 metadata。root 与 volume 的双向 metadata、完整 action manifest 与
coverage/revisions 验证成功后，才提交 `ArtifactIntent` 并原子发布 artifactDigest。committed intent 是唯一
消费线性化点；consumer 跨 project copy root，并为 data volume 生成新的 source。

capture 或 publication acceptance unknown 时，按 intent 和 Provider inventory 对账，不重发。没有 committed
intent 的 template/volume 是 orphan；committed 后 identity 或双向 metadata 漂移的对象进入 quarantine。两者都
不能让 warm lookup 命中。clean failure 可以从最深 committed ancestor 或 base 重新执行 prepare；unknown、漂移或无法删除 orphan
一律 fail closed。quota 满只给出结构化 fallback 或失败，不隐式 GC 或删除未归属对象。

普通 Attempt 不发布 `sandboxState.dockerData`。
Provider 只对完整、可验证的 prepared Sandbox artifact 声明缓存资格。

## doctor 与 fail-closed

`niceeval sandbox provider doctor incus [--development]` 只读。

prepared artifact 是有界资源。`committed` artifact 持续占用 descriptor 的
`artifactMaxInstances`。每个 artifact 持久化 replacement scope；repository 以 scope head
证明同 lineage 的旧 generation 已被替代。

consumer handoff 在 clone 前重新验证 committed generation 并取得 lease，clone 无论成功或失败都释放 lease。
新 generation committed 并成为 head 后，旧 head 只有在 lease 归零且 VM 与 custom block volume
双向 metadata 精确匹配时才进入持久 destroy 流程。VM/volume 的 absent receipt 分别落库，
两者都确认 absent 后才写 `released`。中断恢复只继续同一个已登记 tuple。

若满容量时没有 superseded 且无 lease 的候选，说明有效 working set 确实超出容量。
NiceEval 保留全部缓存并报告容量不足，不做 LRU 猜测。
默认检查 reference；`--development` 分开检查 development domain。
两条结果互相不替代。
doctor 不 create、不 destroy allocation。

失败路径全部 fail-closed：

- 不回退宿主 Docker socket；
- 不回退 raw / managed DinD；
- 不用 development 绿灯遮 reference 红；
- 不把 loop-backed 或目录配额当成 reference capacity；
- 不自动打开、挂载、fsck、adopt 或删除 `/data/niceeval-dind-pool.img`。

旧 DinD pool 对 Incus storage 与 SandboxAllocation ledger 都不可见。
操作者若要处理它，使用 NiceEval 之外的显式运维流程。
