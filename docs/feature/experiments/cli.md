# Experiments —— CLI 反馈模型

```sh
niceeval exp                            # 跑 experiments/ 下全部实验
niceeval exp compare                    # 跑一个实验组
niceeval exp compare/bub-gpt-5.4        # 跑组里一个配置
niceeval exp compare memory/retention   # 再按 eval id 前缀收窄
```

不写 experiment 不能运行 eval。experiment 决定 agent、model、flags、runs、sandbox 与预算;CLI 只负责选择已签入的运行配置和覆盖通用调度参数。

`exp` 的输出有三类消费者:正在终端前观察的人、调用 niceeval 的 AI agent、无人值守的 CI。三者需要的不是同一份文本换个颜色,而是三种不同的反馈模型。

## 三种反馈模型

| 模型 | 主要问题 | 运行中 | 结束时 | 推荐入口 |
|---|---|---|---|---|
| `human` | 还活着吗?卡在哪?哪条失败? | 动态 dashboard + 低频永久事件 | 失败优先摘要 + 下一步命令 | 人在 TTY 中直接运行 |
| `agent` | 还要等多久?失败证据在哪里?下一步调用什么? | 低频、只追加的 checkpoint | 有界 handoff block + 精确 locator | coding agent / 自动修复循环 |
| `ci` | 是否通过?产物在哪?如何归档和标注? | 安静的阶段与 heartbeat | 单行结论 + JUnit / JSON / 快照 | CI job / 非交互门禁 |

CLI 用一个显式 profile 选择反馈模型:

```sh
niceeval exp compare --output human
niceeval exp compare --output agent
niceeval exp compare --output ci
```

`--output auto` 是默认值,只做环境选择:

```text
stderr 是 TTY                    → human
CI=true 或常见 CI 环境标记存在   → ci
其它非 TTY                       → agent
```

显式 `--output` 永远覆盖自动检测。输出 profile 只改变反馈,不改变选择、调度、判定、artifact 或退出码。

`--quiet` 不再承担输出模型。它无法表达“AI 需要低频进度和下一步命令”与“CI 需要稳定日志和报告文件”的差别;对应场景分别使用 `--output agent` 和 `--output ci`。

## 什么动态更新,什么逐条追加

判断标准只有一个:**新值是否使旧值失去意义**。

- 当前计数从 `running=19` 变成 `running=18` 后,旧计数没有保留价值,所以动态覆盖。
- attempt 从“启动 sandbox”进入“运行测试”后,旧阶段没有保留价值,所以动态覆盖。
- 一条 eval 失败并得到 locator 后,后续状态不能替代这条证据,所以只追加一次。
- 一次 retry、spinner 帧或成功完成只是高频过程,既不值得保留历史,也不需要逐条追加。

三种 profile 的具体规则:

| 信息 | `human` | `agent` | `ci` |
|---|---|---|---|
| 运行计划、缓存复用摘要 | 开始时永久追加一次 | `start` 一行 | `start` 一行 |
| elapsed、成本、reused / running / queued / completed | dashboard 内动态覆盖 | 无其它输出满 30 秒才追加 heartbeat | 无其它输出满 60 秒才追加 heartbeat |
| 当前 attempt 阶段、最近进度 | 只在可见 active slot 内动态覆盖 | 不输出 | 不输出 |
| waiting 队列 | 只显示数量,不逐项追加 | heartbeat 里给数量 | heartbeat 里给数量 |
| passed attempt | 只增加动态计数 | 不输出 | 不输出 |
| failed / errored + locator | 撤下 dashboard 后永久追加一次 | 立即追加一次 | 立即追加一次 |
| provisioning retry / backoff | 可见 active slot 内动态更新 | 不逐次输出 | 不逐次输出 |
| retry 耗尽、降级、budget 不可执行 | 去重后永久追加一次 | 去重后追加 warning | 去重后追加 warning |
| budget 耗尽、用户中断、reporter 写失败 | 永久追加一次 | 追加一次 | 追加一次 |
| 最终结论和结果路径 | 永久追加 | handoff block | result / artifact 行 |

“立即追加”也必须有上限,防止失败风暴重新淹没输出。`human` 默认展开前 10 条失败、`agent` 前 5 条、`ci` 前 50 条;超过后只追加一次 `N more failures suppressed`,持续更新总失败数,完整清单保留在快照、JSON / JUnit 和 `view`。上限限制的是终端展开数,不是结果记录数。

Human 的动态刷新由真实状态变化驱动并合并写入,最多每秒 4 帧;elapsed 最多每秒更新一次。spinner 动画本身不能触发重画——静态 `●` 已足以表示 running,存活性由持续增长的 elapsed 证明。这样一批长 eval 在没有状态变化时不会每 80ms 重写终端。

profile 是消费者模型,TTY 是传输能力。显式 `--output human` 但输出被管道捕获时,CLI 自动退化为只追加的 human 文本 checkpoint,绝不能向非 TTY 写 ANSI;它不偷偷改成 `agent` 语义。

### Attempt 阶段

Human active 行的最后一栏显示正式 `AttemptPhase`,不能直接把 `ctx.progress(...)` 的最后一条自由文本当阶段。阶段按生命周期单向推进:

| Phase | Human 展示 | 什么时候出现 |
|---|---|---|
| `sandbox-provision` | creating sandbox | 创建 Docker / E2B / Vercel sandbox;remote agent 跳过 |
| `sandbox-setup` | sandbox setup | 运行 `SandboxSpec.setup()` 环境预置钩子;没有钩子就跳过 |
| `workspace-setup` | preparing workspace | 上传/准备工作区并建立 diff 基线;remote agent 跳过 |
| `eval-setup` | eval setup | 运行 `EvalDef.setup`;没有 setup 就跳过 |
| `agent-setup` | agent setup | 安装 CLI、Skill/plugin、写 agent 配置;没有 `Agent.setup` 就跳过 |
| `telemetry-setup` | configuring telemetry | 创建/配置本次 tracing 出口;没有 tracing 就跳过 |
| `running` | running eval | 执行 `EvalDef.test` 并驱动 agent;这是所有 attempt 都有的主阶段 |
| `diff` | capturing diff | 读取 sandbox 工作区变化;remote / skipped attempt 跳过 |
| `scoring` | scoring | 收集断言并运行可用的 judge;skipped attempt 跳过 |
| `trace` | collecting trace | 等待并筛选迟到的 OTel spans;没有 tracing 就跳过 |
| `teardown` | cleaning up | agent/eval/sandbox cleanup、teardown 与 sandbox stop |

`waiting for a slot` 是 scheduler 状态,发生在 attempt 开始前,不属于 `AttemptPhase`。`passed` / `failed` / `errored` / `reused` / `early-exit` / `budget-unstarted` 是 outcome,发生在阶段结束后,也不塞进 phase 枚举。

每次进入阶段时先发布 phase 再开始对应工作,所以一个长时间卡住的 setup 会稳定停在 `sandbox setup` 或 `agent setup`,而不是继续显示前一阶段。`running` 可以带一个短的可选 detail,例如 `tool: shell` 或 `turn 2`;detail 只更新当前行,不成为永久事件。其它阶段的 adapter 自由日志不得改写 phase。

`AttemptPhase` 是 runner 对真实 lifecycle 的 UI 投影,不是要求 adapter、sandbox provider 或用户 hook 自己设置的公共字段。各层只能在 runner 为它打开的 operation scope 内报告信息:

| Lifecycle owner | Runner 打开的 operation | 这一层可以表达什么 | 不能表达什么 |
|---|---|---|---|
| Sandbox provider | `sandbox.provision` | 分配实例、拉镜像、恢复 snapshot、retry/backoff 的临时 activity;最终 provision diagnostic | 把 phase 改成 agent setup / running |
| `SandboxSpec.setup/teardown` hook | `sandbox.setup` / `sandbox.teardown` | 环境安装、缓存恢复/回填、hook 文件准备进度 | 声称 eval/agent 已开始或完成 |
| Runner workspace | `workspace.prepare` / `workspace.diff` | 上传、git baseline、采 diff | 输出 adapter 自由日志 |
| `EvalDef.setup/test` | `eval.setup` / `eval.run` | 任务依赖准备、eval 主体的短进度和诊断 | 控制 sandbox/agent lifecycle |
| Agent adapter | `agent.setup` / `agent.run` / `agent.teardown` | CLI/Skill/plugin 安装、配置、turn/tool 进度、adapter 诊断 | 直接写终端或切换顶层 phase |
| Telemetry | `telemetry.configure` / `telemetry.collect` | endpoint 配置、span collect 的短进度和诊断 | 用 trace 消息覆盖 running/scoring phase |
| Scoring | `scoring.evaluate` | 断言/judge 进度和诊断 | 改写 agent 执行阶段 |

每个 scope 暴露两种出口:

- `progress({ message, current?, total? })`:短命 activity,只更新 Human 当前行 detail;Agent/CI 不逐条输出。
- `diagnostic({ code, level, message, data?, dedupeKey? })`:需要保留的 warning/error,进入三种 profile 的永久事件流。

scope 由 runner 创建并绑定,调用方不传 `phase`、`scope` 或任意终端控制。Runner 收到 operation start/end 后按固定映射算 `AttemptPhase`;progress 只是该 phase 下的 detail。这样 custom provider/adapter 能表达自己的有用信息,却不会把全局生命周期变成任意字符串协议。

### 输出流和落盘节奏

动态区域与永久事件必须经过同一个 renderer 排序,不能让底层模块绕开它裸写终端。各 profile 的流边界固定为:

| profile | `stderr` | `stdout` |
|---|---|---|
| `human` | 计划、永久事件、dashboard | 最终摘要与结果路径 |
| `agent` | start、heartbeat、failure / warning envelope | 最终 handoff block |
| `ci` | 仅 CLI 无法启动时的用法/配置错误 | 从 start 到 result 的单一有序事件流 |

CI 不把普通 failure 分流到 `stderr`:两个 OS stream 被 CI runner 分开缓冲时会打乱顺序。只有连 profile 都没能启动的 argv、配置加载错误走 `stderr`。

非 TTY 的 `human` 使用 human 文案和 human 最终摘要,但运行中退化为“start 一次 + 永久事件 + 空闲 30 秒 heartbeat”的追加流。它不输出 active attempt 的每次阶段变化。

终端反馈不是结果存储。落盘按恢复价值分两类:

- 结果快照逐步增加:调度前创建快照元数据;每个 attempt 完成后原子写入自己的 `result.json` 与已有 artifacts。进程中断时,已经完成的 attempt 仍可读取。
- `--json` / `--junit` 是整次运行的最终聚合:收尾时写临时文件并原子替换目标,不在每个 attempt 后反复重写一个半成品汇总。

因此“逐步增加”只发生在 append-only 终端事件和 attempt 级快照;Live 状态只覆盖,最终聚合文件只在完成时出现。

## 人在终端里怎么用

人在终端里通常不需要同时阅读 45 条 attempt 日志。运行中最重要的是全局是否推进、并发槽位在做什么、最近出现了什么问题。

```sh
niceeval exp compare --max-concurrency 19
```

TTY 下 `auto` 选择 `human`。开始计划、缓存摘要和已经发生的失败留在 scrollback,其下方才是在 `stderr` 原地维护、不超过终端高度的 dashboard:

```text
Plan: 45 attempts · 9 evals × 5 configs · concurrency 19
Reuse: 6 settled results from the latest matching snapshots
✗ @7m2k9p memory/commit0-cachetool [compare/bub-e2b] gate: cache tool not used

niceeval exp compare                                      2m 14s
45 total · 6 reused · 19 running · 12 queued · 8 completed  $0.84

ACTIVE
● memory/agent-029-use-cac  compare/bub-e2b     1m 42s  running tests
● memory/agent-030-app-rou  compare/codex       1m 18s  editing src/app.ts
● memory/agent-037-updatet  compare/bub-e2b       54s  starting sandbox
… 16 more active
```

Dashboard 只展示当前状态,不保存历史帧:

- 首行固定显示命令和已运行时间;
- 第二行固定使用 `total / reused / running / queued / completed`;后四项是互斥状态且总和等于 `total`;
- `ACTIVE` 使用稳定 slot:一项完成前不因为其它项更新而换位置,完成后才由下一项补位;
- 中间 retry 只改变 active 行尾;失败、错误或 retry 耗尽先撤下 dashboard,在上方永久写一行,再重建 dashboard;
- 终端变窄时先减少可见项,再截断消息,不能换行撑高 dashboard;
- 没有真实状态变化时不重画;历史帧不得进入 scrollback;
- 独立诊断出现时先撤下 dashboard,打印诊断,再在其下方重建。

执行错误即时输出一层可行动摘要,不把 stack 或 provider SDK response 全部灌进 scrollback。摘要固定包含 locator、eval/experiment、正式 phase、稳定 code 和 message:

```text
✗ @2h8m4k1 memory/agent-029-use-cache [compare/claude-e2b] errored · sandbox provision
    sandbox-rate-limit: E2B sandbox allocation failed after 5 attempts
    Inspect: niceeval show @2h8m4k1
```

非致命 diagnostic 使用 warning/error 标记但不冒充 verdict;同一 `dedupeKey` 并发出现时只留一条并显示次数:

```text
! sandbox setup · memory-warmup-degraded (12 attempts)
  Memory warmup failed; continuing with a cold index
```

`niceeval show @2h8m4k1` 展开结构化错误、cause、stack、发生过的阶段与 diagnostics;有 trace 时再用 `--execution` 看执行树。没有 trace 时直接说明 unavailable,不能因此丢失错误详情。

`total` 是选择出的逻辑 attempt 数;`reused` 是缓存携入;`running`、`queued`、`completed` 描述本次需要派发的 attempt。任何一帧都满足 `total = reused + running + queued + completed`,不能出现没有解释的 `Running 39 ... 8/45 done`。

### 人看的结束反馈

结束后清除 dashboard。终端不再打印整张 experiment × eval 明细表——大矩阵在 scrollback 里不可读,完整对比属于 `niceeval show` / `niceeval view`。结束反馈先回答成败,再给失败和下一步:

```text
FAILED  44 passed · 1 failed · 0 errored  (6 reused)
        3m 48s · 1.2M tok · $1.37

FAILURES
@7m2k9p  memory/commit0-cachetool  [compare/bub-e2b]
          gate: cache tool not used

Inspect: niceeval show @7m2k9p
Trace:   niceeval show @7m2k9p --execution
Diff:    niceeval show @7m2k9p --diff
Compare: niceeval view compare

Results:
  .niceeval/compare/bub-e2b/<snapshot>
  .niceeval/compare/codex/<snapshot>
  … 3 more
```

全部通过时不留空的 `FAILURES` 区块:

```text
PASSED  45 passed · 0 failed · 0 errored  (0 reused)
        3m 21s · 1.1M tok · $1.22

Compare: niceeval view compare
Results: .niceeval/compare/<5 snapshots>
```

人在调试单条 eval 时仍用相同模型,只是主动收窄选择,而不是要求 dashboard 展开更多日志:

```sh
niceeval exp compare/bub-e2b memory/commit0-cachetool --force
niceeval show @7m2k9p --execution --diff
```

## AI agent 怎么用

AI agent 不应解析 spinner、表格列宽或本地化的长日志,也不应把整次 transcript 塞进上下文。它需要三样东西:低频存活信号、失败的稳定身份、下一步可直接执行的命令。

```sh
niceeval exp compare memory/commit0 --output agent
```

运行中向 `stderr` 追加 checkpoint。开始时写一行;之后只有失败、错误或去重后的 warning 立即追加。若连续 30 秒没有这些永久事件,才追加一条 heartbeat。普通状态变化和 attempt 日志不触发 checkpoint:

```text
NICEEVAL progress elapsed=0s total=5 reused=1 running=4 queued=0 completed=0
NICEEVAL progress elapsed=30s total=5 reused=1 running=3 queued=0 completed=1
NICEEVAL failure locator=@7m2k9p eval=memory/commit0-cachetool experiment=compare/bub-e2b verdict=failed
NICEEVAL error locator=@2h8m4k1 eval=memory/agent-029-use-cache experiment=compare/claude-e2b phase=sandbox-provision code=sandbox-rate-limit message="E2B sandbox allocation failed after 5 attempts"
NICEEVAL progress elapsed=75s total=5 reused=1 running=1 queued=0 completed=3
```

这些行是稳定的 ASCII `key=value` envelope;值需要空格时使用 JSON 字符串转义。它们用于判断进程是否存活,不是结果数据源。

结束时 `stdout` 只打印一个有界 handoff block。失败再多也限制条数,其余通过结果不逐条列出:

```text
NICEEVAL RESULT failed
summary: 4 passed, 1 failed, 0 errored (1 reused)
snapshots:
  - .niceeval/compare/bub-e2b/<snapshot>
  - .niceeval/compare/codex/<snapshot>
failures:
  - @7m2k9p memory/commit0-cachetool [compare/bub-e2b]
    gate: cache tool not used
next:
  niceeval show @7m2k9p
  niceeval show @7m2k9p --execution
  niceeval show @7m2k9p --diff
```

如果失败超过 handoff 上限:

```text
failures: 12 total, showing 5
  - @7m2k9p …
  - @4q8x1c …
  … 7 more; inspect the JSON result or run `niceeval view compare`
```

Agent 反馈遵守以下边界:

- locator 是继续调查的主键,不能只给 eval id 或第几个 attempt;
- handoff 只给一层失败原因,源码、execution、trace、diff 按需通过 `show` 下钻;
- 快照与 attempt artifacts 是权威数据,checkpoint 和 handoff 不是另一份结果 schema;
- 输出不含 ANSI,不依赖终端宽度,不因本地化改变字段名;
- 进程退出码仍是第一层红绿信号,agent 不靠自然语言猜成功。

### AI 常见循环

先看将运行什么:

```sh
niceeval exp compare memory/commit0 --dry --output agent
```

```text
NICEEVAL PLAN total=5 evals=1 configs=5 runs=1
compare/bub-e2b     memory/commit0-cachetool
compare/codex       memory/commit0-cachetool
… 3 more
```

运行、读取失败 locator、只展开所需证据:

```sh
niceeval exp compare memory/commit0 --output agent
niceeval show @7m2k9p
niceeval show @7m2k9p --execution
```

修复后只重跑受影响项;正常依赖指纹缓存,怀疑缓存口径时才用 `--force`:

```sh
niceeval exp compare/bub-e2b memory/commit0-cachetool --output agent
niceeval exp compare/bub-e2b memory/commit0-cachetool --output agent --force
```

## CI 怎么用

CI 的权威接口是退出码和结构化文件,不是终端表格。推荐命令明确固定语言、严格判定和报告路径:

```sh
NICEEVAL_LANG=en niceeval exp ci \
  --output ci \
  --strict \
  --json .niceeval/ci-summary.json \
  --junit .niceeval/junit.xml
```

运行日志只追加阶段、低频 heartbeat、失败与诊断;不打印通过的 attempt:

```text
niceeval: start total=24 configs=3 concurrency=10 reused=18
niceeval: progress elapsed=60s reused=18 running=6 queued=0 completed=0
niceeval: failed locator=@7m2k9p eval=memory/commit0-cachetool experiment=ci/bub reason="gate: cache tool not used"
niceeval: errored locator=@2h8m4k1 eval=memory/agent-029-use-cache experiment=ci/claude-e2b phase=sandbox-provision code=sandbox-rate-limit message="E2B sandbox allocation failed after 5 attempts"
niceeval: progress elapsed=120s reused=18 running=2 queued=0 completed=4
niceeval: result=failed passed=23 failed=1 errored=0 reused=18 duration=128s
niceeval: json=.niceeval/ci-summary.json
niceeval: junit=.niceeval/junit.xml
niceeval: snapshots=.niceeval/ci/<3 snapshots>
```

CI profile 固定满足:

- 无 ANSI、spinner、表格边框和光标控制;
- 同一种事件一行,方便日志搜索与 CI annotation adapter 消费;
- 连续 60 秒没有其它永久事件时才写 heartbeat,防止长 eval 被平台误判为无输出;失败或诊断刚写过就重新计时,不紧跟一条冗余 progress;
- 成功项不逐条打印,失败和 errored 立即打印;
- 最后一条 result 行可单独阅读,但 JSON / JUnit / 快照才是完整记录;
- reporter 写失败必须判红,因为 CI 要求的结果文件缺失不能降级成普通 warning。

退出码按 `(experiment, eval)` 的最终 verdict 折叠:

```text
0    所有组合通过
1    至少一个组合 failed / errored,或要求的 reporter 写失败
2    CLI / runner 未捕获崩溃
130  用户或平台中断
```

### CI 常见 case

PR 快速门禁,每条只跑一次:

```sh
niceeval exp pr --output ci --strict --runs 1 --junit .niceeval/junit.xml
```

夜间稳定性采样,必须跑满次数而不是首过即停:

```sh
niceeval exp nightly --output ci --strict --runs 5 --no-early-exit \
  --json .niceeval/nightly.json --junit .niceeval/nightly.xml
```

预算受限的外部模型回归:

```sh
niceeval exp regression --output ci --strict --budget 25 \
  --json .niceeval/regression.json
```

预算到顶属于“运行未完整覆盖”,CI 结论不能伪装成全绿:

```text
niceeval: budget_exhausted experiment=regression/codex spent=25.31 unstarted=4
niceeval: result=incomplete passed=36 failed=0 errored=0 unstarted=4 duration=18m02s
```

## 哪些参数改变什么

输出 profile、运行选择和结果出口彼此正交:

| 类别 | 参数 | 作用 |
|---|---|---|
| 反馈模型 | `--output auto\|human\|agent\|ci` | 决定终端展示,不改变运行 |
| 选择 | experiment、eval 前缀、`--tag` | 决定矩阵里有什么 |
| 调度 | `--runs`、`--max-concurrency`、`--timeout`、`--budget` | 决定尝试次数与资源边界 |
| 判定 | `--strict`、`--early-exit` / `--no-early-exit` | 决定 soft 是否判红、是否跑满 |
| 缓存 | `--force` | 忽略可复用结果并全部重跑 |
| 预览 | `--dry` | 只按所选 profile 打印计划,不运行、不落盘 |
| 机器出口 | `--json <path>`、`--junit <path>` | 额外写结构化文件,不改变 profile |

`--json` 和 `--junit` 不是终端格式开关。`human` 也可以同时写 CI 文件,`ci` 也可以只依赖快照。`--dry` 不创建快照、JSON 或 JUnit。

### runs 与首过即停怎样展示

`human` 把未派发原因收进动态计数和最终结论,不能留下永久 running 状态;通过本身不追加到 scrollback:

```text
45 total · 6 reused · 18 running · 12 queued · 9 completed
```

`agent` / `ci` 不伪造两条 skipped attempt,而是在结论中给计数:

```text
NICEEVAL result locator=@2p9k4m verdict=passed attempts=1 planned=3 unstarted=2 reason=early_exit
```

`--no-early-exit` 跑满后使用真实分母:

```text
NICEEVAL result locator=@2p9k4m verdict=passed attempts=3 passed=2 rate=0.667
```

### timeout、budget 与基础设施错误

三种 profile 使用同一错误分类,只改变密度:

```text
human  ! memory/agent-029  compare/bub-e2b  errored · timeout after 60000ms
agent  NICEEVAL error locator=@8c1m2q kind=timeout timeout_ms=60000
ci     niceeval: errored locator=@8c1m2q kind=timeout timeout_ms=60000
```

预算没有成本数据时只提示一次。`human` 把 warning 永久写入 scrollback,`agent` / `ci` 各追加一条稳定 warning;不得每个 attempt 重复同一诊断。

## 用法错误

`exp` 不接受临时 `--agent` / `--model` 覆盖:

```sh
niceeval exp compare --model gpt-5.4
```

```text
experiment 运行不支持 --model。请新增或复制一个 experiment 文件并修改 model。
```

标为 `show` / `view` 专用的 flag 不能被 `exp` 静默忽略:

```sh
niceeval exp compare --history
```

```text
--history 只适用于 niceeval show,不能用于 niceeval exp。
```

用法错误始终写 `stderr` 并非零退出;错误形态不随 profile 改变。`--help` / `--version` 只打印帮助或版本,不加载 experiment、不创建结果。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Library](library.md) —— experiment 怎么组织成可对比组。
- [Runner](../../runner.md) —— 矩阵展开、并发、首过即停、预算与退出码。
- [Results](../results/README.md) —— AI 与 CI 应读取的权威快照。
