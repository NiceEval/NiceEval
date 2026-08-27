# Eval Trajectory —— Lifecycle

## Owner

| Owner | 义务 | 不得越界 |
|---|---|---|
| trajectory 作者 | 写 path、node key、DAG 与 checkpoint edge | 不靠排序暗示依赖 |
| StateProvider | exact restore、commit、fence 与 receipt | 不决定 Eval Verdict |
| Runner | frontier、segment、locator、comparability、并发与 interruption | 不合并 state 分支 |
| Eval | 执行任务并登记原有 Assertion | 不生成 locator |
| Evaluation producer | seal segment Run 与 provenance | 不把 resumed prefix 写成 carry |

## Start 与 node 执行

```text
discover exact trajectory ID and definition
  -> validate path identity and DAG
  -> inspect root or resume locator comparability
  -> debug without --debug ? fail closed before Run / State lifecycle
  -> acquire State lifecycle boundary
  -> State downgrade without --debug ? seal blocked Run, no handoff
  -> create segment Run with expectedNodeIds and expectedSlots
  -> restore root or locator exact StateCheckpointRef
  -> choose ready nodes from frontier
  -> each node: Eval lifecycle -> state commit when declared -> node receipt
  -> planned breakpoint / completion / controlled interruption
  -> seal segment Run and optional handoff
```

每个 commit node 在 `agent.setup` 前 restore 它的 exact predecessor。完成 Eval 后，只有 Agent teardown、cleanup
callback、隔离检查和 State commit 都得到安全终态时，node 才写 `advance: "allowed"`。`failed` Verdict 不阻断这个
判别；它仍以失败语义写入 Run 和退出码。

`--debug` 只授权已是 debug 的 root、locator 或 State downgrade 继续；它不放宽 checkpoint identity、Cohort、
Region、DAG、cleanup、isolation、CAS 或 fence。debug execution 的 Run 与 locator 始终保留非空、封闭 reasons，且
comparability 永不恢复。

## Pause、interruption、debug handoff 与 resume

planned breakpoint 在目标 node 开始前停止选择。controlled interruption 停止尚未开始的 node，并让已开始 node 在
Scope 边界收敛。两种路径都发布新的 segment Run；只有可前进 completed prefix 才带 ResumeLocator。

交接联合只有以下四个有效分支：

| cause | comparability | 生成条件 | resume 条件 |
|---|---|---|---|
| planned breakpoint | comparable | 已开始 node 全部可前进 | 普通 `resume` 可用 |
| controlled interruption | comparable | 已开始 node 全部可前进且 commit 已确定 | 普通 `resume` 可用 |
| planned breakpoint | debug | 同上，且本次命令带 `--debug` | 后续 `resume --debug` 才可用 |
| controlled interruption | debug | 同上，且本次命令带 `--debug` | 后续 `resume --debug` 才可用 |

resume 先验证 locator 的 exact trajectory ID、旧 `RunId`、execution、frontier 与 Cohort。
它再验证 `StateRegionRef`、exact checkpoint、comparability 与 reasons，之后才从该 ref 进入新的 State lifecycle。

新 Run 写入 `resumed-prefix` 后继续 frontier。它不重新执行前缀、不调用 reuse planning，也不从其它 Run 搜索替代
state。

## 阻断终态

| 终态 | 后继 node | handoff |
|---|---|---|
| `passed` + accepted commit + clean | 可开始 | 可以 |
| `failed` + accepted commit + clean | 可开始 | 可以 |
| `errored` | 不可开始 | 不可以 |
| dirty | 不可开始 | 不可以 |
| cleanup failure | 不可开始 | 不可以 |
| isolation failure | 不可开始 | 不可以 |
| commit indeterminate | 不可开始 | 不可以 |

若 commit 已进入 `indeterminate`，Runner 在同一 Scope 内执行 State reconciliation。不能得到 accepted receipt 时，
本段封口为 `blocked`，不发布可恢复 locator。没有 `--debug` 的 debug root、locator 或 acquisition downgrade 也封口为
`blocked`，且不给 locator。

## 并发与生产验收

ready read node 可并发运行。commit node 的 state predecessor 决定可开始次序；同一 Cohort / Region 不会并发提交。

生产 E2E 需观察 exact-ID start、planned breakpoint、普通与 debug resume、failed 可前进、执行错误停止、dirty 收尾与
commit 对账。它还检验 debug fail-closed、debug handoff、built-in comparison 拒绝 debug Run、显式 `view --run` 查看
与 SIGINT handoff。验证从 CLI / Run receipt 读取，不直接读取 provider 私有存储。
