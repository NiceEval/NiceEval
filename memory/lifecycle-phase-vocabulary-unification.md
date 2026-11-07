# 设计裁决:attempt 生命周期词表三套合一(LifecyclePhase),schemaVersion 7

**裁决**(2026-07-14):同一 attempt 生命周期此前存在三套互不映射的闭集词表——live 展示的 `AttemptPhase`(kebab-case:`sandbox-provision`/`running`/单一 `teardown`)、落盘计时的 `PhaseName`(`sandbox.create`/`test`/`score`/`trace`)、错误归因的 `LifecycleOperationName`(`sandbox.provision`/`eval.run`/`workspace.prepare`)。合并为唯一闭集 **`LifecyclePhase`**,live 展示、agent/ci envelope 的 `phase=`、`phases[].name`、`error.phase`、`diagnostics[].phase`、ScopedFeedback 的 scope 全部取自它。单一归属在 `docs/feature/results/architecture.md`。

成员与归并对照(执行序):

| 统一名 | 吸收的旧名 |
| --- | --- |
| `sandbox.queue` | PhaseName 同名(live 原来没有) |
| `sandbox.create` | `sandbox.provision`、`sandbox-provision` |
| `sandbox.setup` | 三套同名 |
| `workspace.baseline` | `baseline`、`workspace.prepare`、`workspace-setup` |
| `eval.setup` / `agent.setup` | 三套同名 |
| `telemetry.configure` | `agent.tracing`(owner 前缀纠错)、`telemetry-setup` |
| `eval.run` | `test`、`running` |
| `agent.run` | operation 同名;唯一嵌套成员,只作 error/diagnostic 归因,不单列计时条目,计时投影 = `eval.run` 的逐 send `steps` |
| `workspace.diff` | `diff` |
| `scoring.evaluate` | `score`、`scoring` |
| `telemetry.collect` | `trace` |
| `eval.teardown` | 新增(原两套闭集都缺,eval cleanup 的诊断只能错归 `eval.setup`,见 lifecycle-operation-missing-eval-teardown 条目,本裁决一并补上) |
| `agent.teardown` / `sandbox.teardown` / `sandbox.stop` | PhaseName 同名;live 原来合成单一 `teardown` 档(Human 展示仍可合并为 cleaning up,机器面保留精确名) |

连带裁决:`AttemptError.operation` / `DiagnosticRecord.operation` 字段改名 `phase`(消灭 phase/operation 双概念),字段改名 = 破坏读取,`schemaVersion` 6 → 7(与 experiment-flags-naming-reversal 确立的「改名即升版、不做读取别名」同一纪律)。

**曾选方案**:三套词表各自保留、文档补一张映射表。**否决理由**:映射表是永久税——每加一个阶段要同步三处、每个消费者要先查表才能对上号;分叉已产生真实可见的漂移(agent/ci envelope 发 `phase=running` 而落盘是 `test`;show 首页 error 区叫 `sandbox provision`、隔两行 timing 区叫 `sandbox create`)。三套词表覆盖的本来就是同一条 `attempt.ts` 固定执行链,差异全是历史拼写,没有一处是语义分歧。

**How to apply**:实现按 `plan/sandbox-phase-timing-surfacing.md`(已按统一词表改写)。代码里 `AttemptPhase` 内部枚举、`LifecycleOperationName` 类型、live 表格 who/phase 映射、i18n 展示文案要一次性换名,不留别名层;grep 旧字符串(`sandbox-provision`、`"test"` 阶段、`agent.tracing`)确认清零。
