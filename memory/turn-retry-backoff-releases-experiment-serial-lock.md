# turn 级重试退避释放实验级串行锁,击穿 maxConcurrency: 1 的串行契约

## 现象

下游 dogfooding 仓库(coding-agent-memory-evals)的 mempal 实验声明了 `maxConcurrency: 1`(文档承诺的「载入…回存临界区声明式串行」模式,见 `docs/feature/experiments/library.md` mempal 示例与 docs-site `write-experiment.mdx`),实测却出现 `running=2`、停止时 force-clean 2 个同实验 sandbox 同时存活。后果:attempt B 的 `mempalSetup`(载入记忆)在 attempt A 的 `mempalTeardown`(回存)之前读到旧状态,跨 eval 记忆累积被静默覆盖,实验结果无效。

下游最初猜测的机制(「maxConcurrency 只 gate agent-run 中段,sandbox 级 setup/teardown 逃逸在外 / 预 provision 下一个 sandbox」)经核对源码**不成立**:runSem(`src/runner/run.ts` 的实验级信号量)经 `runSem.withPermits(1)(gated)` 包住整个 attempt——`runAttemptEffect` 是 `Effect.scoped`(`src/runner/attempt.ts:195`),sandbox create、`SandboxSpec.setup()` 钩子、agent run、teardown 钩子链(runAttemptBody 的 finally)、Scope release(sb.stop)全部在 permit 内完成后才归还名额。稳态路径是完全串行的。

## 根因

真正的泄漏点是 **turn 级重试退避的槽位释放**:

- `src/context/send-retry.ts` 的 `sendWithTurnRetry` 在退避睡眠前 `slot.release()`、睡醒 `slot.reacquire()`(L135-142)。
- 而 `src/runner/run.ts` 构造的这个 `ConcurrencySlot`(L752-761)释放的是 **globalSem + runSem 两把**——把实验级串行锁也一并放掉了。
- 时序:attempt A 撞到可重试 turn 错误(429/overload/5xx)→ 释放 runSem 进入退避睡眠,**此时 A 的 sandbox 还活着、记忆未回存** → attempt B 立即拿到 runSem,provision 自己的 sandbox、跑 `sandbox.setup`(载入未回存的旧状态)开跑 → A 睡醒后 reacquire 要等 B 整个 attempt 结束才拿得回锁。重叠窗口不是退避那 ≤20s,而是 **B 的整个 attempt 时长**,所以 `running=2` 会持续被观察到。

这是实现越权,不是两份契约打架:`docs/feature/error-classification/architecture.md`「退避与槽位」只承诺退避期间释放**全局并发槽位**(不占全局名额陪睡),从未要求释放实验级闸;而 `docs/feature/experiments/README.md`「maxConcurrency 是实验自己的并发闸」+ library.md 的 mempal 示例明确承诺串行。释放 runSem 超出了 error-classification 契约、违背了 experiments 契约。

影响面:任何 `maxConcurrency` 小于全局并发、且跑出过至少一次可重试 turn 错误的实验,其「串行」保证都可能被击穿;依赖串行做共享状态正确性的场景(跨 eval 记忆累积)直接产生数据竞态。

## 修法(已修)

设计裁决见 [experiment-gate-tenure-ruling](experiment-gate-tenure-ruling.md)(两级闸按持有期分工),实现 TODO 树在 `plan/experiment-gate-full-attempt-tenure.md`,落点 commit `9d7b352`(机制 + TSDoc)、`6953d51`(单测)。

`src/runner/run.ts` 的 turn 级 `ConcurrencySlot` 改为只释放/收回 globalSem,退避期间**继续持有 runSem**:

- 死锁核查:睡醒后持 runSem 等 globalSem,与 attempt 起跑的获取定序(runSem → globalSem)一致,无环等待,不引入新死锁。
- 语义核查:退避中攥着实验私有闸只影响本实验自己的 attempt,这正是「串行」的题中之义;不占全局名额的设计目标(error-classification 契约)不受影响。副作用是 maxConcurrency>1 但小于全局的实验在退避期间少用自己的名额——可接受,契约说它是「实验私有资源」。
- 同步义务已履行:`docs/feature/error-classification/architecture.md`「退避与槽位」行、`docs/runner.md`「调度:有界并发」、`docs/feature/experiments/README.md`/`architecture.md` 的 `maxConcurrency` 段、`docs-site/zh/explanation/runner.mdx` 均已声明「实验级闸不释放」;run.ts 里原本叙述旧(有 bug)行为的注释已重写为新契约同一措辞;`ExperimentDef.maxConcurrency` TSDoc 补了同一句(`src/runner/types.ts`)——该 TSDoc 目前不在 `scripts/generate-reference.ts` 的抽取范围内(`ExperimentDef` 未注册进任何 reference region),`pnpm docs:reference` 对它是空操作,不是这次没跑,是这个类型本来就没有生成页可同步。
- 单测:`src/runner/run.test.ts` 新增三个等价类(退避的槽位持有期差、实验级闸覆盖沙箱收尾、护住全局位在退避期间仍让位),`vi.useFakeTimers()` + `vi.spyOn(Math.random)` 控制退避时长(仓库里没有 `TestClock`/`@effect/vitest` 这类 Effect 测试基础设施,是纯 vitest 项目);发现 `vi.runAllTimersAsync()` 会连每个 attempt 30s 外层超时的 `AbortSignal.timeout` 也一并触发,改用有界的 `vi.advanceTimersByTimeAsync(10_000)`。
- 真机回归(下游仓库路径已从 `coding-agent-memory-evals` 改名为 `/Users/ctrdh/Code/MemoryBench`,`pnpm-workspace.yaml` 的 `overrides.niceeval: link:../niceeval` 直接指回本仓库):`experiments/dev-e2b/*mempal*.ts` 现有的 `evals: ["memory"]` 已经匹配不到任何 eval(`evals/memory/` 已被拆分进各仓库同名目录,这几个 dev-e2b mempal 实验文件的 `evals` 字段是那次重组后留下的 stale 配置,建议 MemoryBench 自己核对修一下,不在本次改动范围)。用一个临时实验文件(跑完即删,未提交)复刻同一 `maxConcurrency: 1` + mempal setup/teardown 挂钩,指向 `scoring-smoke/checkpoint`(秒级冒烟任务)、`runs: 2`、`earlyExit: false`,实测:`NICEEVAL progress` 全程 `running<=1`(0s/30s/60s 三次检查点均为 1,90s 时第一个已 `completed`);mempal 状态文件的两次回存 `savedAt` 为 `2026-07-23T03:07:16.383Z` → `2026-07-23T03:08:09.116Z`,严格递增无重叠;两次回存的 `sha256` 完全相同(`bytes: 5430` 两次一致)——证明第二个 attempt 精确读到第一个 attempt 回存的内容,过程中没有任何东西改写或抢跑。

注意 `src/sandbox/retry.ts` 的 `ProvisionSlot`(sandbox provisioning 退避)只释放 sandboxSem,不涉 runSem,无此问题,未改动。
