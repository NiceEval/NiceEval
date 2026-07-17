# Runner —— 执行引擎

运行器是把"一批 eval"变成"一份结果"的调度引擎。它拥有对所有被测对象都一样的部分:发现、有界并发、首过即停、缓存、报告编排。被测对象的差异它一概不管 —— 它只对着 `Agent` 接口(统一动词 `send`)驱动。

## 职责边界

运行器**做**:发现 eval、算指纹决定跳过、建 attempt 列表、有界并发调度、首过即停、把结果交给报告器、落盘 artifact、定退出码。

运行器**不做**:不知道怎么驱动 agent(那是 Agent/Adapter)、不知道怎么打分(那是 Scorer)、不知道结果存哪种格式细节(那是 Reporter)。它是协调者,不是执行者。

## 发现

`runner/discover.ts` 扫 `evals/`:

- 找所有 `*.eval.ts` 与 `*.eval.tsx`(两种扩展名同等对待,`.tsx` 供要在 eval 里写 JSX 的场景),`import` 后看默认导出 —— 单个 eval 用文件 id；数组按位置扇出并加零填充索引(`sql/0000`)；keyed record 按合法业务 key 扇出(`swelancer/15193`)并按 key 字典序稳定排列。没有另一种基于目录约定的隐式发现——沙箱型 eval 也必须有一个 eval 文件。
- 按相对路径排序,保证 id 稳定、输出可比。
- 应用过滤:`niceeval exp <组|配置>` 后的位置参数(id 前缀,如 `weather` 命中 `weather/*`)、`--tag`。
- `niceeval exp` 时另从 `experiments/` 扫实验文件(默认导出 `defineExperiment` 的 `.ts`),据路径推导实验 id;**目录段即"可对比组"** —— `niceeval exp <组>` 跑整个文件夹、同组互为对照(见 [实验怎么组织](feature/experiments/library.md#实验怎么组织文件夹--一组可对比的实验))。实验的 `evals` 字段再筛要跑哪些 eval(见[矩阵展开](#矩阵展开与通过率))。

## 调度:有界并发

核心调度用 `Effect.forEach({ concurrency: "unbounded" })` + **两级信号量**实现:每个 attempt 立刻有自己的 fiber,但执行体要先过实验级闸(`ExperimentDef.maxConcurrency`,可选)、再占全局 permit(全局 `maxConcurrency`)才真正开跑。实验级闸只让该实验自己的 attempt 排队,同批其它实验照常并发——串行化有共享状态的实验(如跨 eval 累积记忆,`maxConcurrency: 1`)不再拖慢整批基线。报告回调走 **permit=1 的信号量串行化**,不阻塞执行 fiber。结果最后按**发现顺序**排序(而非完成顺序),让输出稳定可 diff。

全局并发上限来源:`--max-concurrency` → 配置 `maxConcurrency` → **该沙箱 provider 的推荐默认值**。推荐值反映的是 **provider 侧**约束(daemon 容量、API 配额、session 池大小),不是你的 agent API 限速——后者自己用 `--max-concurrency` 压。「云的就能开大」这个直觉是错的:`docker` 10(本地 daemon 建容器有开销)、`e2b` 20(账户配额的保守估计)、**`vercel` 1**(sandbox session 并发限制严,再高就 429),自定义 provider 取它自己声明的 `recommendedConcurrency`(省略则 5)。实验文件里的 `maxConcurrency` 不参与这条全局解析,只在该实验内部限流。

## 矩阵展开与通过率

一次 `exp` 运行把一批配置展成 attempt:通常来自**一组文件夹里的多个单一配置**(`compare/bub-gpt-5.4` + `compare/codex-gpt-5.4`,见 [实验怎么组织](feature/experiments/library.md#实验怎么组织文件夹--一组可对比的实验));再 × `eval × runs`。比如 2 个实验配置 × `runs: 5` × 3 个 eval = 30 个 attempt。汇总按 `(agent, model, eval)` 分组,不再是单一判定,而是**通过率** + 平均耗时 / token / 成本:

```text
fixtures/button   claude-code   pass@5 = 4/5 (80%)   mean 34s · 58k tok · $0.44
fixtures/button   codex         pass@5 = 3/5 (60%)   mean 41s · 72k tok · $0.39
```

用于衡量 agent 的稳定性(一次过 ≠ 可靠),以及跨 agent 的**质量 × 成本**对比。不写实验时退化成单 agent × `runs`。

## 首过即停(earlyExit)

取通过率本可以跑满 N 次,但若只关心"能不能做到",先过一次即可停其余:

- 每个 eval 配一个 `AbortController`。
- **只有 `passed` 触发首过即停**:某 attempt 通过且 `earlyExit` 开 → `abort()` 同 eval 其余 attempt;被 abort 的不计入分母。`run:earlyExit` 事件只在实际省略了至少一个轮次时发出——最后一轮才通过时没有可省的轮次,不发事件。
- `errored` 不触发:超时、限流、沙箱挂掉这类瞬态基建错误在下一个 attempt 上完全可能自愈,因一次 errored 停掉其余样本等于放弃重试机会,还会把基建抖动放大成整题无结果。
- 确定性错误不靠 earlyExit 兜,走独立的 **run 级 fail-fast**:凭据缺失、模板不存在、作者代码必现抛错这类同因必复现的错误,识别出(预检命中,或同一错误 code 在同一 eval 连续复现)即停止派发受同一配置影响的后续 attempt,如实报 errored——这是止损,不是「首过即停」,两个机制互不混用。
- 默认开;`--no-early-exit` 关(想要完整通过率分布时)。

## 预算护栏(budget)

实验可设 `budget`(整个 run 的估算成本上限 $),`--budget` 覆盖。运行器只按**已完成 attempt 的实测花费**判断:同一 budget 域(experimentId,或没有 experiment 时的 agent 名)的已完成花费一旦到顶,就**停止派发新 attempt**——已经在飞的照常跑完,不会被中途打断;到顶之前不做任何预测性节流,并发完全由 `--max-concurrency` 与实验级 `maxConcurrency` 决定。这是有意的取舍:budget 是防止无限烧钱的安全网,不是精确计费闸,不应该反过来限制吞吐——已花 + 在飞未结算的总花费可能因此短暂超出 budget。连续多个**已经发起 agent turn** 的 attempt 都拿不到成本数据(agent 不报用量)时,budget 对该域不可执行,运行器给一条去重后的 warning 而不是每个 attempt 重复提示；`sandbox.create`、setup 等发生在首个 agent turn 之前的错误没有成本事实,只报告其结构化 attempt error,不额外产生 budget warning。

预算耗尽而导致的未派发 attempt 数量计入运行[完成状态](#完成状态)的 `unstarted`,让整次运行的结论落在 `incomplete`,不能在 CI 里伪装成全绿。

## 预热与复用:冷启动移出关键路径

沙箱冷启动的优先级排序(先预制环境、再小 setup、最后才是池化)在 [Sandbox · 性能](feature/sandbox/architecture.md#性能预制环境复用与预热)——provider 侧提供"创建、重置、销毁"的能力;什么时候预创建、什么时候复用是运行器的调度决策,契约如下:

- **预热池**:开启后,运行器在调度开始时按 `min(预热池大小, 计划 attempt 数)` 预先创建同 spec 沙箱挂进池里;attempt 到达 `sandbox.create` 阶段时先领池中现货,领到则该阶段只计领取耗时,池空则回落到即时创建。池只在同一次 run 内存活,run 结束时未被领用的沙箱一并销毁。
- **跨 case 复用**:开启后,attempt 收尾不销毁沙箱,而是按变更分类账重置回锚点状态(`$HOME` 等 workdir 外路径不保证清理)再交给同 spec 的下一个 attempt;`sandbox.stop` 只在最后一次使用后发生。默认**关闭**——全新沙箱是隔离性的默认值,复用是用启动时间换隔离强度的显式选择,只应在 setup 成本可证明地主导总耗时、且 eval 不在 workdir 外留状态时开启。
- 两者都不改变生命周期钩子的调用顺序:复用的沙箱在每个 attempt 里仍然按 [固定调用链](feature/sandbox/architecture.md#沙箱在生命周期里的位置) 走一遍 `sandbox.setup` 链与分类账锚点,钩子必须幂等。
- [`--keep-sandbox`](feature/sandbox/cli.md) 生效时跨 case 复用关闭:留存的现场必须属于那一次 attempt,不能被 `git clean` 重置交给下一个。预热池不受影响——run 结束时未被领用的池内沙箱照常销毁,留存只作用于跑过 attempt 的沙箱。

## 缓存:指纹去重

`runner/fingerprint.ts` 对每个 eval 算 `(eval 代码 + 相关配置)` 的哈希:

- 上次判定是 `passed` 或 `failed`、且指纹未变 → 默认**跳过**,结果**携带合入**本次快照(带 `artifactBase` 指回原 artifact,落盘语义见 [Results · 两类条目](feature/results/architecture.md#resultjson)),最新快照因此保持完整。两者都是"跑完了、判定确定"的终态,没理由重花一次 agent/sandbox 成本去复现同一个已知结果。
- 改了 fixture、改了配置、或 `--force` → 重跑。
- `errored`(框架/环境层面的不确定失败,如超时、沙箱挂了)和 `skipped` 不缓存,总会重试——它们的判定本身不可信,不是可复用的终态。

让"改一个 case 重跑"只花那一个 case 的时间,而不是全量。

## 超时:双层保护

- **Adapter 内层超时** —— agent CLI 自己的超时。
- **运行器外层超时** —— attempt deadline 用 Effect 的 interruption 中断 Scope 里的 verdict-producing 工作 fiber,把超时转换成 `errored`(error: timeout)draft;外层 Scope 不关闭,有界收尾(teardown 链、留存决策)仍在同一个 Scope 的 release 里照常完成——与 [Sandbox 的 Scope / finalizer 模型](feature/sandbox/architecture.md#留存keep与注册表)同一套语义,即使 agent 卡死也能强行收尾。

外层是兜底,保证一个卡死的 case 不会挂起整批。

## 环境预置不进运行器,但按顺序调它

运行器不承载环境预置的内容,只固定各生命周期钩子的**调用点与顺序**,钩子内部做什么全部交给对应的作者决定。调用点从外到内:

- **实验级** —— `ExperimentDef.setup`:每实验整场至多一次、宿主机侧,本实验第一个要派发的 attempt 前跑,返回的 cleanup 在全部 attempt 收尾后跑(中断也跑);管每实验一份的共享服务(隧道、mock server),语义见 [Experiments · 实验级生命周期](feature/experiments/architecture.md#实验级生命周期setup-与它返回的-teardown)。
- **沙箱级** —— 沙箱创建后、变更分类账锚点之前,运行器调用 `experiment.sandbox` 链上挂的环境钩子(`SandboxSpec.setup()` / `.teardown()`,见 [Sandbox · 沙箱生命周期钩子](feature/sandbox/library.md#沙箱生命周期钩子setup--teardown))。
- **eval 级 / agent 级** —— 沙箱固定段("发现 → 调度 → 沙箱起停 / 分类账锚点 / 折叠 agent diff → 评分 → 报告"这条主轴)之内,还分出这条 eval 的任务夹具(`EvalDef.setup` 或 `test(t)`)和 agent 自己的一次性预置([`SandboxAgent.setup`](feature/adapters/architecture/agent-contract.md#生命周期不变量))。

跨实验共享、生命周期长于一次 run 的外部服务(共享 DB、公司内网服务本体)仍然用外部编排(`docker compose` / CI 脚本)起停、经 env 传入——这类资源跨进程共享,不属于任何一次 run 的生命周期。完整分工表见 [环境预置放哪](feature/sandbox/library.md#环境预置放哪)。

**下游分析**(二次评分、自定义指标)走 [reporter](observability.md#reporters),不另设运行钩子——这是从 agent-eval 的 `onRunComplete` 收敛过来的(见 [Experiments 砍字段](feature/experiments/architecture.md#从-agent-eval-砍掉了什么以及为什么))。

## 运行器事件

`Reporter.onEvent` 收到一串结构化事件,把结果同步到 artifact、CI 报告或外部平台:

```text
run:start           { evals, agent, shape }   # shape = { evals, configs, totalRuns, maxConcurrency, snapshotStartedAt }
eval:start          { eval, agent, model, attempt, experimentId }
eval:complete       { result }                # EvalResult,fresh 结果此时已带最终 locator(见下)
run:earlyExit       { evalId, experimentId }
run:budgetExceeded  { budget, spent }
run:saved           { summary }
run:summary         { summary }
```

`verdict` 是互斥的判定分类:`passed` / `failed` / `errored` / `skipped`,没有 `scored` 中间态。`run:summary.failed` 只统计断言/评分不通过,环境、超时、adapter 或 agent runtime 问题统计到 `errored`。fresh attempt 的最终 `locator` 在构造调度计划时就由预先确定的 `snapshotStartedAt` 与 attempt 身份算好并传入执行体,所以留存注册表、feedback、`eval:complete` 与落盘 `result.json` 从第一次观察起就是同一个值;reporter 不需要等 artifact 落盘。

终端反馈(human dashboard、agent envelope、CI 的单一 stdout 事件流)不消费这条 `Reporter` 事件流——它们由一个独立的反馈 coordinator 消费另一条内部事件通道,只服务 `--output` 选出的 profile,不对外暴露,详见 [CLI · 反馈 coordinator](cli.md#反馈-coordinator一个-run-只有一个终端协调者)。

## 完成状态

verdict 计数回答"每条 eval 判定成什么",不回答"这次运行是否完整覆盖了计划"。完成状态是独立于 verdict 计数的第二个结论:

```ts
type CompletionStatus = "complete" | "incomplete" | "interrupted";

interface RunCompletion {
  status: CompletionStatus;
  /** budget 耗尽导致未派发的 attempt 数。 */
  unstarted: number;
  /** 首过即停在已知 verdict 下主动省略的计划次数——省下的重复验证,不算"未完整覆盖"。 */
  earlyExitUnstarted: number;
  reporterErrors: readonly ReporterError[];
}
```

- budget 耗尽或确定性错误触发 run 级 fail-fast(见[首过即停](#首过即停earlyexit))而停止派发时 → `incomplete`,`unstarted` 是这两类未派发 attempt 的合计。
- 用户或平台中断(Ctrl+C / SIGTERM)→ `interrupted`。
- 任一 [required reporter](cli.md#required-reporter) 写失败 → 非 `complete`;失败明细进 `reporterErrors`,`required` 字段区分它是否让整体判红。
- 首过即停(earlyExit)省略的重复验证次数单独计入 `earlyExitUnstarted`,不进入 `unstarted`——它是已知 verdict 下主动省下的成本,不是遗漏。

CI 的最终结论(退出码、`niceeval: result=...` 行)必须读 `RunCompletion`,不能只看 `passed` / `failed` / `errored` 计数——预算耗尽但零 `failed` / `errored` 的一次运行仍然不是"全绿"。

## 退出码

退出码由 `RunCompletion.status` 与按 `(experiment, eval)` 折叠后的 verdict 共同决定;三种 `--output` profile(见 [Experiments · CLI 反馈模型](feature/experiments/cli.md))共用同一套语义:

- `0` —— `status: "complete"`,且没有任一 `(experiment, eval)` 组合判定为 `failed`(含 `--strict` 下 soft 未达标而改判的)或 `errored`。
- `1` —— 至少一个组合 `failed` / `errored`;或 `status: "incomplete"`(budget 未覆盖全部计划);或存在 required reporter 写失败。
- `2` —— CLI / 运行器未捕获的崩溃。
- `130` —— `status: "interrupted"`(用户或平台中断)。

退出码按 eval 折叠,不按 attempt 折叠:同一个 eval 被 `runs` + `earlyExit` 重试吸收的失败(先挂一次、后来某次通过)不会让进程判红,只有该 eval 最终判定为 `failed` / `errored` 才计入。

## 相关阅读

- [Architecture](architecture.md) —— 运行器在四段数据流里的位置与端到端时序。
- [Experiments · CLI 反馈模型](feature/experiments/cli.md) —— human / agent / ci 三种 profile 怎样展示这篇讲的调度、预算与完成状态。
- [CLI](cli.md) —— `exp` 怎么把这些调度行为接进 Effect 核心与反馈 coordinator。
- [Sandbox](feature/sandbox/README.md) —— 预热与复用的 provider 支持,以及环境预置放哪。
- [Observability](observability.md) —— 运行器产出的 artifact 与报告。
