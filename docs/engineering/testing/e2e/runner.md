# 功能域 · Runner

本域回答一个问题：**确定性 Runner 项目在真实候选包上是否正确计划、携带与去重历史 attempt，并公开读回通用执行 timing。**
它由 `e2e/runner/` 功能 Repo 承担；manifest 的 `areas` 包含 `runner`，并进入无密钥 PR lane。

仓库使用签入的确定性 Agent fixture，不依赖真实 provider、网络或凭据。每条会修改 Eval 或结果的 case 都在自己的项目副本中运行；公开观察只通过安装后的 `niceeval exp` 与 `niceeval show` 完成。

## Owner 表

| Owner ID | 用户结果 | 形态 | 文件 | Lane |
| --- | --- | --- | --- | --- |
| [`#runner-carry-partial-reuse`](#runner-carry-partial-reuse) | 改变一个 Eval 只重新派发其 identity，未改变的 Eval 继续携带 | Journey E2E | `e2e/runner/test/carry-partial-reuse.test.ts` | PR |
| [`#runner-history-dedup`](#runner-history-dedup) | 强制重跑或同时运行同一实验时，不重复执行已经完成的题目 | Journey E2E | `e2e/runner/test/history-dedup.test.ts` | PR |
| [`#runner-generic-timing`](#runner-generic-timing) | 公开 timing 保留 setup、run 与 send 的完成关系 | 单边界 E2E | `e2e/runner/test/timing.test.ts` | PR |
| [`#runner-accept-reanchor`](#runner-accept-reanchor) | 用户审阅变更后 accept 旧结果，新 Run 立即进入 project-current，但不获得未来 carry 许可，并保留审计 provenance | Journey E2E | `e2e/runner/test/accept-reanchor.test.ts` | PR |
| [`#runner-group-or-stop-dispatch`](#runner-group-or-stop-dispatch) | 一个 Eval 的 `.orStop()` 不饿死其它 Eval Group lane | Journey E2E | `e2e/runner/test/group-or-stop-dispatch.test.ts` | PR |
| [`#runner-group-wave-gap-dispatch`](#runner-group-wave-gap-dispatch) | 慢 Group lane 不阻塞已有空闲资源的快 lane 后继 | Journey E2E | `e2e/runner/test/group-wave-gap-dispatch.test.ts` | PR |
| [`#runner-max-concurrency-invocation-local`](#runner-max-concurrency-invocation-local) | 两条 Invocation 各自拥有 Experiment `maxConcurrency` 额度，不互相占用或收紧 | Journey E2E | `e2e/runner/test/max-concurrency-invocation-local.test.ts` | PR |
| [`#runner-shared-state-lifecycle`](#runner-shared-state-lifecycle) | 相同 `sharedState.key` 的不同 Experiment 不交错外部状态生命周期 | Journey E2E | `e2e/runner/test/shared-state-lifecycle.test.ts` | PR |
| [`#runner-provider-lane`](#runner-provider-lane) | 等待 sharedState 不占用同一 exclusive Provider lane | Journey E2E | `e2e/runner/test/provider-lane.test.ts` | PR |
| [`#runner-shared-state-scheduler`](#runner-shared-state-scheduler) | 同 Invocation 的同 key waiter 不饿死 holder 的后继 Attempt | Journey E2E | `e2e/runner/test/shared-state-scheduler.test.ts` | PR |
| [`#runner-shared-state-startup-authority`](#runner-shared-state-startup-authority) | 启动遗留 teardown 先取得同 key authority，健康等待不泄露 token | Journey E2E | `e2e/runner/test/shared-state-startup-authority.test.ts` | PR |
| [`#runner-fresh-sandbox-provider-stop`](#runner-fresh-sandbox-provider-stop) | fresh custom Provider 的 group stop 失败保留 sharedState，公开输出不泄露 token | Journey E2E | `e2e/runner/test/fresh-sandbox-provider-stop.test.ts` | PR |
| [`#runner-shared-state-recovery`](#runner-shared-state-recovery) | 暂停、崩溃或 cleanup 失败的 sharedState 只会等待或显式恢复，旧 owner 不会影响新 holder | Journey E2E | `e2e/runner/test/shared-state-recovery.test.ts` | PR |

## 验收命题

### runner-carry-partial-reuse

在私有项目副本中只改变一个 Eval 源码。选中该 Eval 的 dry plan 必须标为重新派发；执行后，全量 dry plan 与真实 dispatch 必须只携带更新后的该 Eval 和从未变化的另一 Eval。该命题排除“一个改动作废全矩阵”与“改动仍误携带”的两种错误。

同一 owner 还从安装后的 CLI 验证 config identity 的 optional sharedState 投影：未声明时旧结果继续公开 carry；首次声明 key
或 A→B 改 key 都使全部 slot 成为 `identity-mismatch`。Journey 不读取或预置私有 Record。

### runner-history-dedup

同一 Eval 的两次 `--rerun all` 必须形成两条不同的 origin Attempt identity。之后默认 carry 不能复制新的公开 Attempt locator。不带 locator 或 `--run` 的 `show` 必须列出全部身份仍匹配的 Run，包括两次 origin Run 与 carry Run。

两个终端同时运行同一个实验时，后开始的命令会等前一个命令完成发布。它随后直接使用前一个命令已经完成的题目结果，不会再次调用 agent、sandbox 或 judge 去跑同一题目。

### runner-generic-timing

确定性 Direct Agent 真实执行一次 `setup` 与一次 `send`。owner 从安装后 CLI 运行 `timing` Experiment，
再对其唯一 Attempt 执行 `niceeval show @<locator> --timing --json`。
返回文档必须只有该 Attempt 一项，其 locator 等于 Eval event 的 locator，origin Run 等于本次
Experiment receipt 的唯一 Run；不能从额外 entry 中宽松挑一项继续断言。

公开 receipt 必须各有一个 completed 的 `eval.run` / `eval.run`、`attempt.setup` / `agent.setup` 与
`agent.send` / `turn1`。前两项是各自 lifecycle phase 的 root；`agent.send` 的 `parentIntervalId`
必须指向 `eval.run` 的 `intervalId`。

这条是上述通用 Runner timing 的唯一 E2E owner。它不比较 duration、offset 或随机 interval ID，
也不把 Adapter 的 execution/session/protocol 结果重复写成 timing 测试。

### runner-group-or-stop-dispatch

两个 Group 的首条 Eval 以 `.orStop()` 失败时，后继成员仍须与第三个 Group 的 in-flight 成员并行进入 Agent。该 Journey 守护失败只结束当前 Eval、不同 Group lane 继续派发；排查经过见 [`memory/group-or-stop-dispatch-starvation.md`](../../../../memory/group-or-stop-dispatch-starvation.md)。

### runner-group-wave-gap-dispatch

三个 Group 各自拥有三条串行 Eval。gamma 首槽在 Agent 内等待 alpha 与 beta 的第三槽到达；若调度器要求第二 wave 的所有 lane 都先取得并发位，gamma 第二槽会被自身 predecessor 挡住，alpha 与 beta 第三槽也会被第二轮统一准入挡住。正确实现只对所有 lane 的首槽做一次公平屏障，九条 Eval 全部通过。

### runner-max-concurrency-invocation-local

第一条 Invocation 以三条会阻塞的 Eval 填满同一 Experiment 的较大 `maxConcurrency`。它们仍持有全部本次额度时，第二条
Invocation 的单条检查 Eval 必须立即进入 Agent 并通过。

两条命令的结果都经安装后的 `niceeval exp --json` 验收，且检查 Eval 不出现 lock wait。Experiment 并发额度因此是
Invocation-local：它不会被另一条 Invocation 消耗、共享或收紧。

### runner-accept-reanchor

在私有项目副本中完整运行初始 Experiment，并从公开执行输出取得 locator。随后修改 Eval 入口或被导入源码模块。

Human `--dry` 对 identity gap 必须关联具名差异原因、旧 Attempt 的 locator / verdict，以及可直接复制的
`niceeval accept @<locator>`。JSON `--dry` 只稳定验收 total / reused、slot state 和 readback locator / verdict；format、version
与私有容器形状不是本 Journey 的契约。

accept 在新 Run 写入 reference Member，locator 仍是同一 source Attempt identity，不生成或改写
Attempt。用户用返回的 Run ID 执行 `show --run`，公开读回保留源 Attempt 的 verdict / evidence；
目标 Member 的 action 说明本次采用，不另建 provenance family。

同一 Journey 随后执行无 `--run` 的 `show --json`。默认 `project-current` 必须选中刚创建的 accepted Run，且分母只包含它的当前 Slot。
这证明 accept 与普通 current planning 使用同一份 link 后 Experiment、physical plan、fingerprint 与 config identity，而不只是证明历史 Run 可被 explicit selector 打开。

`accepted` 只解释该 Run 当时为何采用这个 Attempt，不是未来复用许可。后续 `--dry` 仍按当前 reuse
policy 重新判断；原来的 identity gap 不会因为历史上执行过 accept 而被静默改成 carried。

本 Journey 不签入 `.niceeval`、不手写 manifest，也不从 accept 中段开始。不同资格、差异或错误分支需要独立输入时，可以在
Runner Repo 增加专用 Eval；完整 fingerprint 等价类仍不在 E2E 重复穷举。

### runner-shared-state-lifecycle

两个不同 Experiment 声明相同 `sharedState.key`，并在各自 Experiment hook 中独占同一份外部状态。第一个 Run 从 setup
到 teardown 尚未结束时，第二个 Run 不得进入自己的 setup；前者 teardown 完成后，后者才可取得该状态并完整运行。

带 `sandboxReuse` 的切片还证明两个 Attempt 使用同一物理 Sandbox。最后一个 Attempt settle 后，Sandbox
lifecycle/finalizer scope barrier 与 Experiment teardown barrier 都阻止第二 Invocation 的 setup。

前者由 `SandboxLayer.teardown` hook 确定性阻塞。实际 provider finalizer 也由同一 `Scope.close` 等待，但 fixture
不直接注入它。该 Journey 经安装后的 `niceeval exp` 证明等待方没有在共享状态区间内运行 Hook 或执行 Eval。

### runner-provider-lane

等待同 key 的 Experiment 即使使用同一条 exclusive Provider lane，也不占用那条 lane。另一个不依赖该 key 的
Experiment 必须能先进入自己的 Sandbox 与 Agent body；Provider 的实际 Sandbox / Agent body 仍按 lane 串行。

### runner-shared-state-scheduler

同一 Invocation 选择两个共享同 key 的 Experiment，各自至少三条 Attempt，并以 `--max-concurrency 2` 执行。holder 的第一条 Attempt 在 public Agent boundary 等待自己的第二条；同 key waiter 不得占用有限 dispatch worker，故 holder successor 必须先启动，整次 Invocation 随后完整结束。

### runner-shared-state-startup-authority

强杀留下 teardown registration 与 active sharedState generation 后，下一条 Invocation 的启动自愈必须先等待同 key authority，不能抢先执行旧 teardown。公开 inspection 是 owner token 的唯一可见面；重启命令的健康 `state-lease-waiting` info 与 durable Run diagnostic 都不含 token。这个 owner 还验证 full-carry / zero-Attempt 的 selected Experiment：它也必须等待该安全边界，不能因没有 dispatch fiber 跳过。

### runner-fresh-sandbox-provider-stop

未启用 `sandboxReuse` 的 fresh custom Provider 让真实 `group.stop` 确定性失败。失败必须进入 Experiment cleanup 判定并保留 sharedState，后续同 key waiter 继续等待；只有公开 explicit recovery 成功后才可进入 setup。普通 CLI 输出和 `show --json` 的 Run diagnostic 都不能泄露 inspection 才显示的 owner token。

### runner-shared-state-recovery

暂停 owner 超过旧 heartbeat expiry 语义后仍持有 lease；等待方既不 setup 也不派发 Attempt，SIGINT 能及时取消，恢复 owner
并完成 lifecycle 后下一位才进入。Journey 还只经 public `exp --teardown --recover-shared-state` inspection 验证活跃 owner
的 heartbeat 时间会前进，而 SIGSTOP 后停在最后诊断值但不触发接管。强杀 owner 后 waiter 不自动接管；inspection 显示完整
owner evidence，错误 token 拒绝，exact token 加双确认才可进入。

恢复 Journey 在第一条公开 recovery 的 teardown barrier 期间启动第二条恢复命令，后者必须因 live exact recovery actor
被拒绝；它证明 competing recovery 不能取代 live immutable generation。

free generation 后新 holder 可进入，而旧 token 再次 recovery 失败，第三 waiter 仍等待新 holder。另一 case 让真实
Experiment teardown 失败，验证 lease 留存而不是 CLI exit sweep 删除。没有声明 teardown 的 target 则在进入 recovery
generation 前被拒绝，后续同 key waiter 仍不能 setup；`--json` 的 explicit recovery 参数组合也会非零拒绝。根帮助与
`exp help` 都列出完整四参数恢复用法，避免机器调用方误把人读 stderr 当成 NDJSON。

## 边界

指纹输入等价类、携带门的穷举、barrier / fake-clock 并发与资源生命周期是无法由此确定性消费项目稳定穷举的 Unit 例外。它们必须按 [Unit 存在资格](../unit/README.md#存在资格)保留最小矩阵；本域不复制这些内部算法矩阵。
