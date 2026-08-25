# Nested Docker —— Lifecycle

V1 是 DestroyOnly。
每条 Attempt 使用一台一次性 Incus VM；成功、失败、中断与强杀后都销毁 instance、disk、network 与 lease。
`--keep-sandbox` 与 `sandboxReuse` 在创建资源前失败。

## Planning

```text
discover Eval and Experiment
  -> select the single SandboxTemplate
  -> collect DockerExecutionRequirement
  -> Incus planner returns capability receipt
  -> compare requirement / capability
  -> compute BuildKey, CaseKey and SetupPrefixKey
  -> reserve Provider capacity
```

capability 或 capacity 不满足时，尚未创建 Run resource、Sandbox、模型 session 或 Attempt execution。
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

## 宿主重启

Provider 先恢复自己的 durable instance / storage inventory，NiceEval 再开始 reconcile。
NiceEval 不在 activation 中重建 Provider mount tree，也不把旧 pathname 扫描成 allocation。
所有上次在飞 allocation 遵循 DestroyOnly。
committed Provider artifact 保持 immutable，可供新的 Invocation clone。

## artifact capture

prepare worker 取得独立 allocation 并执行 eligible SetupPrefix。
成功后进入 quiesce barrier；任何进程、secret、外部 lease 或 state-surface 证明失败都取消 publication 并销毁 prepare allocation。

Provider snapshot 成功且 manifest 双向验证后，才原子发布 artifactDigest。
capture 中断留下的 snapshot 没有 committed manifest，reconciler 视为 orphan 并删除，不会让 warm lookup 命中。

普通 Attempt 不发布 `sandboxState.dockerData`。
Provider 只对完整、可验证的 prepared Sandbox artifact 声明缓存资格。

## doctor 与 fail-closed

`niceeval sandbox provider doctor incus [--development]` 只读。
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
