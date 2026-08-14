# State —— Lifecycle

## Owner

| Owner | 义务 | 不得越界 |
|---|---|---|
| Experiment / Trajectory | 绑定预期持久的 `StateRegionRef` 与 `sharedState.key` 完整独占范围 | 不伪造 boundary、checkpoint ref 或 fence |
| StateProvider | 签发 identity、restore、CAS、fence、reconcile 与 release | 不折叠 Eval Verdict |
| Runner | mint execution / commit ID，保存 receipt，关闭 Scope | 不猜测 provider state |
| Sandbox / Agent | 在准确时序运行任务与收尾 | 不绕过 state lease |
| Evaluation producer | seal Run-owned state receipt | 不把 receipt 改成 Assertion |

## 完整时序

```text
acquire sharedState.key
  -> enter Effect Scope
  -> StateProvider.bind(StateRegionRef, ExpectedPersistence)
  -> StateProvider.acquire(sealed StateBinding with provider-issued persistence boundary)
  -> record first-acquisition digest / CAS / idempotency / fencing guarantees
  -> acquire actual Sandbox / external state carrier
  -> restore({ checkpoint: exact StateCheckpointRef }), or fresh initialize
  -> layer prepare / agent.ensure / agent.setup / Eval work
  -> Agent teardown and registered cleanup callback
  -> classify mutation observation against persistence boundary
  -> verify access / reset / isolation and state persistence preconditions
  -> Runner mints commitId
  -> provider CAS(full expectedPredecessor, fence, commitId)
  -> commit indeterminate ? reconcile(same commitId) : retain receipt
  -> provider finalizer and Scope release
  -> release sharedState.key
```

State restore 在真实载体取得后执行，并在 `agent.setup` 使用它之前结束。`sharedState.key` 在 Sandbox lifecycle
setup 前取得，因此两条 Invocation 不能交错 restore 和提交同一份外部状态。

首次 acquire 不能提供 digest，或不能保证 CAS、idempotency、fencing 时，Runner 将该 execution 标为 debug 并封存
对应原因。这个决定贯穿 execution lifetime；后续 receipt 即使带有 `contentDigest` 也不能使它回到 comparable。

## Commit eligibility

Runner 只在 Agent teardown、已登记 cleanup callback 与隔离检查都结束后提交。任一阶段失败或超时，state execution
都没有 new checkpoint。provider finalizer 在 accepted commit 后失败时保留 receipt，却把 execution 标为 dirty，供
要求干净终态的 consumer 判别。

`failed` Eval 工作仍可得到干净的 accepted state commit。`errored` execution、未验证隔离、失败的 cleanup callback、
失败的 Scope finalizer 或 indeterminate commit 都不能声称安全的后继 checkpoint。

Region 内的实际变化可标为 `intentional-state`，但该标签不放宽 commit eligibility。access、reset、cleanup、
symlink 或 isolation failure 即使发生在 persistence surface 内也保持失败；Region 外变化保持
`unexpected-mutation`。观察不完整只产生 `classification-unavailable`，不能根据 Verdict 序列猜污染或安全。

## Indeterminate 与 interruption

受控 interruption 停止新的 state 工作，关闭活动 Scope，并对已经签发的 commit ID 对账。它不会创建替代 commit ID。
对账只携带原 receipt 的同一 `commitId`、完整 `expectedPredecessor` 与 fence；无法证明 accepted 时，execution
以 `commit-indeterminate` 结束。后续工作必须从另行给出的 exact `StateCheckpointRef` 或 fresh Cohort 起步。

## 生产验收

生产入口验收让一个真实 provider 经过 exact restore、accepted commit、相同 `commitId` 的 replay、完整 predecessor
冲突、fence 拒绝与响应丢失后的同 ID 对账。

它还检验首次 acquire 缺少 digest、首次 acquire 缺少 CAS / idempotency / fencing guarantee 与 Scope interruption。
真实 Sandbox 切片同时检验 boundary 内记忆变化、boundary 外残留、观察不完整，以及与 access/reset/isolation
failure 并存时不被遮蔽。
E2E 读取 Run receipt 和 CLI 输出，不读取 provider 私有存储。
