# Lifecycle

## Planning

```text
discover Eval and Experiment
  -> select the single SandboxTemplate
  -> collect normalized Nested Docker requirement
  -> Provider plans SandboxCase and returns capability receipt
  -> compare requirement / capability
  -> compute BuildKey, CaseKey and SetupPrefixKey
  -> reserve Provider capacity
```

capability 或 capacity 不满足时，尚未创建 Run resource、Sandbox、模型 session 或 Attempt execution。
排队等待 capacity 的成员显示 provider-capacity reason，不占已经执行中的四个 Attempt 位。

## Create 与 ready

1. control plane 写入 `reserved` allocation 与 generation。
2. 写入 `creating` intent，以 allocation id 作为 Provider idempotency key 调用 create/clone。
3. Provider 回读 object metadata；NiceEval 提交 locator。
4. guest init mount root、workspace 与专用 Docker data disk，启动 dockerd。
5. readiness 以 Agent 执行身份运行 `docker info` 与 `docker compose version`。
6. readiness 核对默认 Unix socket、无宿主 endpoint、4 GiB quota 与空 private runtime state。
7. allocation 进入 `ready`，Sandbox 才交给 before action、Agent 与 Eval test。

create 返回 acceptance unknown 时，adapter 用 idempotency key 和 inventory 查询。找不到对象且 Provider
明确返回 never-accepted 才能重发；无法确定时保持 intent 并停止该 Provider 新 admission。

## 普通收尾

1. Agent runtime teardown，并 fence 新 command。
2. 执行已登记的 after/cleanup，停止 Attempt 创建的 Compose project。
3. guest 回报 Docker container、volume、network、builder 与 session inventory。
4. NiceEval 把 allocation 写成 `destroy-requested`。
5. Provider 原子销毁 instance、private disks、network 与 ephemeral locator。
6. inspect 返回 absent 后提交 `destroyed`，释放 reservation。

NiceEval 不要求先清空 private Docker data 才允许 Provider delete。删除整份私有 allocation 本身就是隔离
证明；guest inventory 只服务诊断和发现 Provider delete 漏项。

## `SIGKILL` 与控制进程重启

新 control process 取得 execution-domain leadership 后，先 fence 旧 generation，再枚举 ledger 与 Provider
inventory。所有 `creating`、`ready`、`handed-off` 与 `destroy-requested` allocation 进入对账。

已经到达 Agent turn 的 Attempt 标记 `environment incomplete`。系统不会从仍存活的 VM继续 Agent，
也不会自动重新发送模型输入。reconciler 对 exact Provider object执行 detached destroy，
并在 absent receipt 后释放 capacity。

## 宿主重启

Provider 先恢复自己的 durable instance/storage inventory，NiceEval 再开始 reconcile。NiceEval 不在
activation 中重建 Provider mount tree，也不把旧 pathname扫描成 allocation。所有上次在飞 allocation
遵循 DestroyOnly；committed Provider artifact 保持 immutable，可供新的 Invocation clone。

policy 发布中断时只恢复最后一个 committed policy。pending policy 可以丢弃，但它创建的 Provider object
仍会因 metadata 出现在 inventory 对账中，并按未提交 generation 销毁。

## artifact capture

prepare worker 取得独立 allocation并执行 eligible SetupPrefix。成功后进入 quiesce barrier；任何进程、
secret、外部 lease 或 state-surface证明失败都取消 publication并销毁 prepare allocation。

Provider snapshot 成功且 manifest 双向验证后，才原子发布 artifactDigest。capture 中断留下的 snapshot
没有 committed manifest，reconciler 视为 orphan并删除，不会让 warm lookup 命中。

## doctor

`niceeval sandbox provider doctor <provider>` 默认只读 capacity、executionDomainId、artifact manifest 与
inventory，不执行 cleanup。`--probe` 使用独立 doctor allocation id和 generation，完整走 create/ready/
destroy；它不能取得或操作 Eval allocation 的 locator。

doctor 发现损坏时只登记 exact quarantine 建议。只有 reconciler 能根据 durable ownership 执行 destroy，
doctor 自身不通过“顺手 cleanup”改变被诊断现场。
