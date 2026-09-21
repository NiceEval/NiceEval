# 功能域 · Runner

本域回答一个问题：**确定性 Runner 项目在真实候选包上是否正确计划、携带与去重历史 attempt，并公开读回通用执行 timing。**
它由 `e2e/runner/` 功能 Repo 承担；manifest 的 `areas` 包含 `runner`，并进入无密钥 PR lane。

仓库使用签入的确定性 Agent fixture，不依赖真实 provider、网络或凭据。每条会修改 Eval 或结果的 case 都在自己的项目副本中运行；公开观察只通过安装后的 `niceeval exp` 与固定 `niceeval query` 完成。

## Owner 表

| Owner ID | 用户结果 | 形态 | 文件 | Lane |
| --- | --- | --- | --- | --- |
| [`#runner-carry-partial-reuse`](#runner-carry-partial-reuse) | 改变一个 Eval 只重新派发其 identity，未改变的 Eval 继续携带 | Journey E2E | `e2e/runner/test/carry-partial-reuse.test.ts` | PR |
| [`#runner-history-dedup`](#runner-history-dedup) | 强制重跑或同时运行同一实验时，不重复执行已经完成的题目 | Journey E2E | `e2e/runner/test/history-dedup.test.ts` | PR |
| [`#runner-generic-timing`](#runner-generic-timing) | Agent setup、send 与 teardown 保留完成关系、原始失败和 cleanup diagnostic | Journey E2E | `e2e/runner/test/timing.test.ts` | PR |
| [`#runner-accept-reanchor`](#runner-accept-reanchor) | 用户采用符合有限规则的旧结果后恢复当前结果可用性，相同目标后续持续沿用，保留原始证据 | Journey E2E | `e2e/runner/test/accept-reanchor.test.ts` | PR |
| [`#runner-group-or-stop-dispatch`](#runner-group-or-stop-dispatch) | 一个 Eval 的 `.orStop()` 不饿死其它 Eval Group lane | Journey E2E | `e2e/runner/test/group-or-stop-dispatch.test.ts` | PR |
| [`#runner-group-wave-gap-dispatch`](#runner-group-wave-gap-dispatch) | 慢 Group lane 不阻塞已有空闲资源的快 lane 后继 | Journey E2E | `e2e/runner/test/group-wave-gap-dispatch.test.ts` | PR |
| [`#runner-max-concurrency-invocation-local`](#runner-max-concurrency-invocation-local) | 两条 Invocation 各自拥有 Experiment `maxConcurrency` 额度，不互相占用或收紧 | Journey E2E | `e2e/runner/test/max-concurrency-invocation-local.test.ts` | PR |
| [`#runner-shared-state-lifecycle`](#runner-shared-state-lifecycle) | 相同 `sharedState.key` 的不同 Experiment 不交错外部状态生命周期 | Journey E2E | `e2e/runner/test/shared-state-lifecycle.test.ts` | PR |
| [`#runner-provider-lane`](#runner-provider-lane) | 等待 sharedState 不占用同一 exclusive Provider lane | Journey E2E | `e2e/runner/test/provider-lane.test.ts` | PR |
| [`#runner-provider-capacity-queue`](#runner-provider-capacity-queue) | 等待 Docker profile 容量的 Attempt 保持 queued，且不阻塞其它 Provider | Journey E2E | `e2e/runner/test/provider-capacity-queue.test.ts` | PR |
| [`#runner-shared-state-scheduler`](#runner-shared-state-scheduler) | 同 Invocation 的同 key waiter 不饿死 holder 的后继 Attempt | Journey E2E | `e2e/runner/test/shared-state-scheduler.test.ts` | PR |
| [`#runner-shared-state-startup-authority`](#runner-shared-state-startup-authority) | 启动遗留 teardown 先取得同 key authority，健康等待不泄露 token | Journey E2E | `e2e/runner/test/shared-state-startup-authority.test.ts` | PR |
| [`#runner-fresh-sandbox-provider-stop`](#runner-fresh-sandbox-provider-stop) | fresh custom Provider 的 group stop 失败保留 sharedState，公开输出不泄露 token | Journey E2E | `e2e/runner/test/fresh-sandbox-provider-stop.test.ts` | PR |
| [`#runner-shared-state-recovery`](#runner-shared-state-recovery) | 暂停、崩溃或 cleanup 失败的 sharedState 只会等待或显式恢复，旧 owner 不会影响新 holder | Journey E2E | `e2e/runner/test/shared-state-recovery.test.ts` | PR |
| [`#runner-shared-state-zombie-owner-recovery`](#runner-shared-state-zombie-owner-recovery) | Linux zombie owner 不会阻止新 sharedState holder 通过公开恢复流程取得状态 | Journey E2E | `e2e/runner/test/shared-state-zombie-owner-recovery.test.ts` | PR |

## 验收命题

### runner-carry-partial-reuse

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [修改评测源码](../../../feature/experiments/use-case/缓存与沿用/修改评测源码.md)

在私有项目副本中只改变一个 Eval 源码。选中该 Eval 的 dry plan 必须标为重新派发；执行后，全量 dry plan 与真实 dispatch 必须只携带更新后的该 Eval 和从未变化的另一 Eval。该命题排除“一个改动作废全矩阵”与“改动仍误携带”的两种错误。

同一 owner 还从安装后的 CLI 验证 config identity 的 optional sharedState 投影：未声明时旧结果继续公开 carry；首次声明 key
或 A→B 改 key 都使全部 slot 成为 `identity-mismatch`。Journey 不读取或预置私有 Record。

Application 未声明 `behaviorRevision` 时，dry plan 与实际派发都不能自动 carry。
声明稳定版本后可按通常策略 carry；仅改变远端行为版本、保持项目源码不变，也必须重新执行。
这个切片由 `e2e/runner/test/application-reuse.test.ts` 拥有。

### runner-history-dedup

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [并行Invocation协作](../../../feature/experiments/use-case/并发/并行Invocation协作.md)

同一 Eval 的两次 `--rerun all` 必须形成两条不同的 origin Attempt identity。之后默认 carry 不能复制新的公开 Attempt locator。`runs.list` 必须列出全部身份仍匹配的 Run，包括两次 origin Run 与 carry Run。

两个终端同时运行同一个实验时，后开始的命令会等前一个命令完成发布。它随后直接使用前一个命令已经完成的题目结果，不会再次调用 agent、sandbox 或 judge 去跑同一题目。

### runner-generic-timing

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [experiments](../../../feature/experiments/README.md)

确定性 Direct Agent 真实执行 setup、send 与 teardown。owner 从安装后 CLI 运行 `timing` Experiment，
再对其唯一 Attempt 通过显式 request 执行 `niceeval query run` 的 `attempt.timing` operation。
返回 document 必须只以该 locator 的闭合 trace 交付 timing；不能从额外 entry 中宽松挑一项继续断言。

公开 receipt 必须各有一个 completed 的 `eval.run` / `eval.run`、`attempt.setup` / `agent.setup` 与
`agent.send` / `turn1`。前两项是各自 lifecycle phase 的 root；`agent.send` 的 `parentIntervalId`
必须指向 `eval.run` 的 `intervalId`。

同一 Journey 还从正式 case workdir receipt 验证 Agent lifecycle。setup 失败后 teardown 只执行一次；
未声明 setup hook 的 Agent 仍执行 teardown。setup 或 send 与 teardown 同时失败时，公开 error event
继续保留原始失败；`attempt.trace` 的 cleanup diagnostic 独立保存 teardown failure。

owner 不读取私有 Record 文件，也不比较 duration、offset 或随机 interval ID。

### runner-group-or-stop-dispatch

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [快慢实验混跑](../../../feature/experiments/use-case/并发/快慢实验混跑.md)

两个 Group 的首条 Eval 以 `.orStop()` 失败时，后继成员仍须与第三个 Group 的 in-flight 成员并行进入 Agent。该 Journey 守护失败只结束当前 Eval、不同 Group lane 继续派发；排查经过见 [`memory/group-or-stop-dispatch-starvation.md`](../../../../memory/group-or-stop-dispatch-starvation.md)。

### runner-group-wave-gap-dispatch

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [快慢实验混跑](../../../feature/experiments/use-case/并发/快慢实验混跑.md)

三个 Group 各自拥有三条串行 Eval。gamma 首槽在 Agent 内等待 alpha 与 beta 的第三槽到达；若调度器要求第二 wave 的所有 lane 都先取得并发位，gamma 第二槽会被自身 predecessor 挡住，alpha 与 beta 第三槽也会被第二轮统一准入挡住。正确实现只对所有 lane 的首槽做一次公平屏障，九条 Eval 全部通过。

### runner-max-concurrency-invocation-local

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [并行Invocation协作](../../../feature/experiments/use-case/并发/并行Invocation协作.md)

第一条 Invocation 以三条会阻塞的 Eval 填满同一 Experiment 的较大 `maxConcurrency`。它们仍持有全部本次额度时，第二条
Invocation 的单条检查 Eval 必须立即进入 Agent 并通过。

两条命令的结果都经安装后的 `niceeval exp --json` 验收，且检查 Eval 不出现 lock wait。Experiment 并发额度因此是
Invocation-local：它不会被另一条 Invocation 消耗、共享或收紧。

### runner-accept-reanchor

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [experiments](../../../feature/experiments/README.md)

在私有项目副本中完整运行初始 Experiment，从 receipt 与固定 `run.get` 取得两个 ordinal 的 locator。
任务、判据和分值由签入 fixture 固定；采用成功路径只修改[有限规则](../../../feature/experiments/cache.md#显式采用的资格)允许的输入。
改写 `t.send()` 文本不能作为成功采用的 fixture。

完整 Journey 必须通过以下公开检查点：

1. `project.get` 显示当前完整分母与 identity gaps，旧 locator 可下钻，但旧分数不贡献当前质量指标。
2. `exp --dry` 与 `accept @<locator> --dry` 给出实际差异、资格与下一步；两次读取均不发布 Run 或调用 Agent。
3. 单条 `accept` 发布一个 reference Member。固定 `run.get` 显示 accepted action、同一 origin locator 及未修改的结果与证据。
4. `project.get` 显示该位置已有可用结果。只采用一个 ordinal 不应填补未授权的缺口，也不应破坏其它 ordinal 的可用结果。
5. 显式采用其余合格缺口，并经 `project.get` 确认完整目标均有可用结果；随后相同目标连续两次 `exp` 均沿用原 Attempt。公开调用计数不增加，新 Run 只含 carried 引用。
6. 当前目标再次发生不被允许的变化时，该位置重新成为 gap；过去的 accepted 不能绕过新判据。

以下独立反例使用隔离的项目副本，按真实公开结果分别验收，不并成一个多目的 Journey：

| 输入或动作 | 必须观察到的结果 |
| --- | --- |
| 修改任务、loader 数据、隐藏判据或分值 | 采用预览与正式采用均拒绝，Run 列表没有新增；旧分数只在历史读取中保留。 |
| 同批 locator 中一项不合格，或整 Run 与当前 slot 集不闭合 | 整批失败且零写入，不静默取交集。 |
| 完整 Score 结果为零 | 可以沿用或在其它资格满足时采用；不把 scored 伪装成 passed。 |
| Score partial、执行 errored、timing 不完整 | 显示真实阻断原因，不能用零分补齐或转成正常采用。 |
| 当前 source slot pending 或执行失败，旧 Run 有可用结果 | 保留最新位置的缺口，不自动回扫旧结果；显式选择旧 locator 才进入采用预检。 |
| 同一目标采用后连续 carry，再撤去唯一有效采用见证 | 不以 carried action 自证等价；当前读取保留具名 gap，固定 origin Run 仍可读。 |

本 Journey 不签入 `.niceeval`、不手写 manifest，也不从 accept 中段开始。不同资格、差异或错误分支需要独立输入时，可以在
Runner Repo 增加专用 Eval；完整 fingerprint 等价类仍不在 E2E 重复穷举。

### runner-shared-state-lifecycle

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [串行保护共享状态](../../../feature/experiments/use-case/并发/串行保护共享状态.md)

两个不同 Experiment 声明相同 `sharedState.key`，并在各自 Experiment hook 中独占同一份外部状态。第一个 Run 从 setup
到 teardown 尚未结束时，第二个 Run 不得进入自己的 setup；前者 teardown 完成后，后者才可取得该状态并完整运行。

带 `sandboxReuse` 的切片还证明两个 Attempt 使用同一物理 Sandbox。最后一个 Attempt settle 后，Sandbox
lifecycle/finalizer scope barrier 与 Experiment teardown barrier 都阻止第二 Invocation 的 setup。

前者由 `SandboxLayer.lifecycle().teardown` hook 确定性阻塞。实际 provider finalizer 也由同一 `Scope.close` 等待，但 fixture
不直接注入它。该 Journey 经安装后的 `niceeval exp` 证明等待方没有在共享状态区间内运行 Hook 或执行 Eval。

### runner-provider-lane

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [串行保护共享状态](../../../feature/experiments/use-case/并发/串行保护共享状态.md)

等待同 key 的 Experiment 即使使用同一条 exclusive Provider lane，也不占用那条 lane。另一个不依赖该 key 的
Experiment 必须能先进入自己的 Sandbox 与 Agent body；Provider 的实际 Sandbox / Agent body 仍按 lane 串行。
该 owner 使用仅测试的 custom exclusive Provider，并把 `HOME`、`CODEX_HOME` 与 `TMPDIR` 固定在 case 的隔离项目副本内；
它只证明 generic exclusive scheduler，不代表任何公开 host Sandbox 产品能力。

### runner-provider-capacity-queue

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Sandbox · 命令计划时序](../../../feature/sandbox/lifecycle.md#命令计划怎样投影这条时序)

可控 Docker profile fixture 先占满容量，再同时派发一个 Docker waiter 与一个不使用该 profile 的 Attempt。安装后的 `niceeval exp` 必须把 waiter 显示为 `queued`，reason 为 `provider-capacity`，顶部 queued/running 汇总来自同一状态；它在 reservation grant 前不能出现 `running` 或 `creating sandbox`。等待期间不占普通 sandbox semaphore，因此不相关 Provider 的 Attempt 仍能进入创建并完成。

fixture 释放一个 profile slot 后，waiter 才迁移到 `running` / `creating sandbox`。Human 与 invocation-local JSON queue transition 断言同一顺序；测试不读取 reducer、Docker profile 私有状态或 `.niceeval/` 落盘。

### runner-shared-state-scheduler

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [串行保护共享状态](../../../feature/experiments/use-case/并发/串行保护共享状态.md)

同一 Invocation 选择两个共享同 key 的 Experiment，各自至少三条 Attempt，并以 `--max-concurrency 2` 执行。holder 的第一条 Attempt 在 public Agent boundary 等待自己的第二条；同 key waiter 不得占用有限 dispatch worker，故 holder successor 必须先启动，整次 Invocation 随后完整结束。

### runner-shared-state-startup-authority

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [恢复中断运行](../../../feature/experiments/use-case/并发/恢复中断运行.md)

强杀留下 teardown registration 与 active sharedState generation 后，下一条 Invocation 的启动自愈必须先等待同 key authority，不能抢先执行旧 teardown。公开 inspection 是 owner token 的唯一可见面；重启命令的健康 `state-lease-waiting` info 与 durable Run diagnostic 都不含 token。这个 owner 还验证 full-carry / zero-Attempt 的 selected Experiment：它也必须等待该安全边界，不能因没有 dispatch fiber 跳过。

### runner-fresh-sandbox-provider-stop

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [恢复中断运行](../../../feature/experiments/use-case/并发/恢复中断运行.md)

未启用 `sandboxReuse` 的 fresh custom Provider 让真实 `group.stop` 确定性失败。失败必须进入 Experiment cleanup 判定并保留 sharedState，后续同 key waiter 继续等待；只有公开 explicit recovery 成功后才可进入 setup。普通 CLI 输出和 `run.summary` 固定 query 都不能泄露 inspection 才显示的 owner token。

### runner-shared-state-recovery

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [恢复中断运行](../../../feature/experiments/use-case/并发/恢复中断运行.md)

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

### runner-shared-state-zombie-owner-recovery

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [恢复中断运行](../../../feature/experiments/use-case/并发/恢复中断运行.md)

Linux 上失去可执行进程的 zombie owner 会通过公开 recovery 交接 sharedState；新 holder 不会被无法继续运行的旧 owner 无限阻塞。

## 边界

指纹输入等价类、携带门的穷举、barrier / fake-clock 并发与资源生命周期是无法由此确定性消费项目稳定穷举的 Unit 例外。它们必须按 [Unit 存在资格](../unit/README.md#存在资格)保留最小矩阵；本域不复制这些内部算法矩阵。
## 删除旧实验后明确采用指定 Run，保持原 Attempt 身份与证据，并在目标不变时持续沿用；整批范围或输入不合格时零写入。 {#runner-rename-exact-source}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/experiments/use-case/缓存与沿用/迁移错误归属的配置.md](../../../feature/experiments/use-case/缓存与沿用/迁移错误归属的配置.md)

删除旧实验后明确采用指定 Run，保持原 Attempt 身份与证据，并在目标不变时持续沿用；整批范围或输入不合格时零写入。
## Judge 模型不变时沿用，修改 Eval 模型后重新评价 {#judge-model-reuse}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/experiments/cache.md#复用资格](../../../feature/experiments/cache.md#复用资格)

Judge 模型不变时沿用，修改 Eval 模型后重新评价
## 取消后有界排空并发布已采集的外部用量和附件，保留评分且停止后续派发。 {#adapter-capture-interrupt}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/run/README.md](../../../feature/run/README.md)

取消后有界排空并发布已采集的外部用量和附件，保留评分且停止后续派发。
## cleanup 截止关闭采集入口，保留已得分和成功附件并公开执行错误。 {#adapter-capture-timeout}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/run/README.md](../../../feature/run/README.md)

cleanup 截止关闭采集入口，保留已得分和成功附件并公开执行错误。
