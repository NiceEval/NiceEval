# Experiments —— CLI 反馈模型

```sh
niceeval exp                            # 跑 experiments/ 下全部实验
niceeval exp agents/codex               # 按目录路径跑一批实验
niceeval exp agents/codex/gpt-5.4       # 跑一个实验
niceeval exp agents/codex/gpt           # 按文件名前缀跑一族实验
niceeval exp agents/codex memory/retention # 再按 eval id 前缀收窄
```

不写 experiment 不能运行 eval。experiment 决定 agent、model、flags、runs、sandbox 与预算;CLI 只负责选择已签入的运行配置和覆盖通用调度参数。

### 实验选择器怎样解析

位置参数只选择 experiment id / 路径；experiment 自己的 `evals` 再过滤发现到的 eval，尾随 eval id 前缀只对本次运行继续收窄。

1. **精确 id 优先**:位置参数精确等于某个已发现实验 id 时只选中这一个——即使它同时是同目录下其它文件名的前缀。例如精确输入 `compare/codex-gpt-5.6-luna` 只选中它自己,不牵连 `compare/codex-gpt-5.6-luna--agents-md` 等共享前缀的变体。
2. **目录前缀次之**:参数精确等于任意深度的已发现目录路径时,选中该目录下全部实验。
3. **文件名前缀兜底**:以上都不精确命中,且参数形如 `目录/文件名前缀` 时,若目录段精确匹配一个已发现目录,选中该目录下文件名以这个前缀开头的全部实验。目录段永远要求精确匹配,不允许跨目录误配(`dev` 不会误中 `dev-e2b`);文件名段允许裸前缀,与下文 eval id 的前缀过滤同一条规则——把同一 agent 的功能变体(`--agents-md` / `--mempal` / `--nowledge` 等后缀)当一族一起选中。
4. 以上都不命中 → `No experiment matched`(见[用法错误](#用法错误))。

```sh
niceeval exp compare/codex --dry
```

```text
plan: 4 attempts · 1 eval × 4 configs · runs 1
compare/codex-gpt-5.6-luna              memory/commit0-cachetool
compare/codex-gpt-5.6-luna--agents-md   memory/commit0-cachetool
compare/codex-gpt-5.6-luna--mempal      memory/commit0-cachetool
compare/codex-gpt-5.6-luna--nowledge    memory/commit0-cachetool
```

第 4 条零命中时,不摊平打印每一个已发现 id,只给可浏览的目录清单和下一步命令:

```sh
niceeval exp dev-e3b
```

```text
No experiment matched: dev-e3b. Available paths: agents/, suites/, stress/.
Run `niceeval exp <path> --dry` to preview a plan.
```

`exp` 的输出与 `show` 遵循同一条全 CLI 原则:**每条命令一个人读 text 面,`--json` 是机器面**。没有 `--output` 这类 profile flag,没有第三档:

- **不加 flag = 人读文本**。stderr 是 TTY 时渲染动态 live 面板;非 TTY(管道、重定向、CI 日志)自动降级为只追加的无框文本——start 一次、失败与诊断立即一行、空闲 30 秒一条心跳、结束摘要收尾。CI 日志页给人看的就是这个降级流,不需要单独的 CI 档。
- **`--json` = NDJSON 事件流**。coding agent、CI annotation adapter、任何脚本共用这一套;一行一个 JSON 对象,词法就是 JSON,没有需要另学的自造 envelope 语法。

两种形态消费同一套事实,只改变呈现:选择、调度、判定、artifact 与退出码全部不变。TTY 只决定人读文本用哪种版式(live 面板还是追加流),不改变形态归属;机器判断成败第一层永远是退出码。运行结束后的深读一律走 [`niceeval show`](../reports/show.md)(text 或 `--json`),运行期反馈不承担第二份结果 schema。

`--quiet` 不存在:安静与否不是消费者差别,机器消费直接用 `--json`。

## 什么动态更新,什么逐条追加

判断标准只有一个:**新值是否使旧值失去意义**。

- 当前计数从 `running=19` 变成 `running=18` 后,旧计数没有保留价值,所以动态覆盖。
- attempt 从“启动 sandbox”进入“运行测试”后,旧阶段没有保留价值,所以动态覆盖。
- 一条 eval 失败并得到 locator 后,后续状态不能替代这条证据,所以只追加一次。
- 一次 retry、spinner 帧或成功完成只是高频过程,既不值得保留历史,也不需要逐条追加。

两种形态的具体规则(人读文本列里,「动态覆盖」只发生在 TTY live 面板;非 TTY 文本没有动态区域,动态项直接不输出、永久项照常追加):

| 信息 | 人读文本 | `--json` |
|---|---|---|
| 运行计划、缓存复用摘要 | 开始时永久追加一次 | `start` 事件一行 |
| elapsed、成本、reused / running / queued / completed | live 面板内动态覆盖;非 TTY 走空闲心跳 | 无其它输出满 30 秒才追加 `progress` 事件 |
| 当前 attempt 阶段、最近进度 | 只在可见 active slot 内动态覆盖 | 不输出 |
| 实验级 setup / teardown 起止 | ACTIVE 区运行级行(TTY);非 TTY 起止各追加一行 | `experiment_setup` / `experiment_teardown` 事件 |
| 运行级瞬时通知(provider 一次性通知、judge 预检……) | 永久追加一行 | 不输出 |
| waiting 队列 | 只显示数量,不逐项追加 | `progress` 事件里给数量 |
| passed attempt | 只增加动态计数 | 不输出(题目级结论走 `eval` 事件) |
| failed / errored + locator | 撤下 live 面板后永久追加一次 | `failure` / `error` 事件立即一行 |
| provisioning retry / backoff | 可见 active slot 内动态更新 | 不逐次输出 |
| retry 耗尽、降级、budget 不可执行 | 去重后永久追加一次 | 去重后追加 `warning` 事件 |
| budget 耗尽、用户中断、reporter 写失败 | 永久追加一次 | 各自事件追加一次 |
| 最终结论和结果路径 | 永久追加(结论、`FAILURES`、`NEXT` 面板) | `result` 事件 |

“立即追加”也必须有上限,防止失败风暴淹没**人读**输出:人读文本默认展开前 10 条失败,超过后只追加一次 `N more failures suppressed`,持续更新总失败数。`--json` 不做 suppression——每条失败一个有界事件,机器不需要注意力保护;完整证据仍在快照,由 `show` 读取。上限限制的是终端展开数,不是结果记录数。

Human 的动态刷新由真实状态变化驱动并合并写入,最多每秒 4 帧;elapsed 最多每秒更新一次。spinner 动画本身不能触发重画——静态 `●` 已足以表示 running,存活性由持续增长的 elapsed 证明。这样一批长 eval 在没有状态变化时不会每 80ms 重写终端。

形态是消费者模型,TTY 是传输能力。框线、ANSI 和光标控制同属传输能力:人读文本被管道捕获时,CLI 自动退化为只追加的无框文本,绝不能向非 TTY 写框字符、ANSI 或光标序列;它也不偷偷改成 JSON——机器形态只由显式 `--json` 进入。

### Attempt 阶段

Human active 行的最后一栏显示当前生命周期阶段。阶段词表全仓只有一套——[Results Format 的 `LifecyclePhase` 闭集](../results/architecture.md#resultjson):live 展示、`--json` 事件的 `phase` 字段、落盘 `phases[].name` 与 `error.phase` 用的是同一组字符串,不存在「展示一套名、落盘另一套名」。Human 展示列只是各阶段的人读投影:

| Phase | Human 展示 | 什么时候出现 |
|---|---|---|
| `sandbox.queue` | queued for sandbox | 等待容器创建信号量(并发限流);remote agent 跳过 |
| `sandbox.create` | creating sandbox | 创建 Docker / E2B / Vercel sandbox;remote agent 跳过 |
| `sandbox.setup` | sandbox setup | 运行 `SandboxSpec.setup()` 环境预置钩子链;没有钩子就跳过 |
| `workspace.baseline` | preparing workspace | 打变更分类账锚点(归因的起点);remote agent 跳过 |
| `eval.setup` | eval setup | 运行 `EvalDef.setup`;没有 setup 就跳过 |
| `agent.setup` | agent setup | 安装 CLI、Skill/plugin、写 agent 配置;没有 `Agent.setup` 就跳过 |
| `telemetry.configure` | configuring telemetry | 创建/配置本次 tracing 出口;没有 tracing 就跳过 |
| `eval.run` | running eval | 执行 `EvalDef.test` 并驱动 agent;这是所有 attempt 都有的主阶段 |
| `workspace.diff` | capturing diff | 读取 sandbox 工作区变化;remote / skipped attempt 跳过 |
| `scoring.evaluate` | scoring | 收集断言并运行可用的 judge;skipped attempt 跳过 |
| `telemetry.collect` | collecting trace | 等待并筛选迟到的 OTel spans;没有 tracing 就跳过 |
| `eval.teardown` / `agent.teardown` / `sandbox.teardown` / `sandbox.stop` | cleaning up | 收尾段:Human 合并显示为一档,机器面(`phase=` 与落盘)保留精确名 |

`agent.run` 是闭集中唯一的嵌套成员:adapter `send` 期间在 `eval.run` 内打开,只作为错误 / 诊断的归因值(`phase=agent.run`),Human 展示不切换顶层阶段——active 行仍是 running eval,send 细节走 detail。

支持原生流的 adapter 必须把执行中的 agent 事件压成当前 active 行的短 detail；例如 Codex 的
`codex exec --json` 会显示 `tool: pnpm test`、`thinking: …` 或 `assistant: …`。detail 是最后一条
短预览，不逐帧追加、不过度保留工具输出；完整消息、工具输入/结果仍由 attempt 完成后写入
`events.json`，通过 `niceeval show @<locator> --execution` 阅读。

`waiting for a slot` 是 scheduler 状态,发生在 attempt 开始前,不属于生命周期阶段。`passed` / `failed` / `errored` / `reused` / `early-exit` / `budget-unstarted` 是 outcome,发生在阶段结束后,也不塞进 phase 闭集。

每次进入阶段时先发布 phase 再开始对应工作,所以一个长时间卡住的 setup 会稳定停在 `sandbox setup` 或 `agent setup`,而不是继续显示前一阶段。`running eval` 可以带一个短的可选 detail,例如 `tool: shell` 或 `turn 2`;detail 只更新当前行,不成为永久事件。

phase 是 runner 对真实 lifecycle 的单方面投影,不是 adapter、sandbox provider 或用户 hook 能直接设置的公共字段:每一次转换都由 `attempt.ts` 沿它自己固有的执行顺序、在真正跨入该步骤时发出;没有对应 hook/配置的步骤直接跳过,不产生空阶段。各层想表达「我正在做什么」走各自作用域的 `progress()` / `diagnostic()`(sandbox provider、hook、eval、adapter 各拿各的句柄,契约见 [Library · 生命周期代码怎样向这次运行反馈](library.md#生命周期代码怎样向这次运行反馈));`AgentContext.log(text)` 是 `progress({ message: text })` 的别名,不是第二条通道。progress 只更新 live 面板当前 active 行的次要文本,非 TTY 文本与 `--json` 不展示,也不写入 results;任何一层都不能借它改写 phase 本身,或声称进入了另一个生命周期阶段。

### 实验级钩子的显示

`ExperimentDef.setup` 与它返回的 teardown 不属于任何单个 attempt(等待 setup 的 attempt 不占并发位,在计数里保持 `queued`),所以它们不是 attempt 阶段,而是**运行级生命周期行**。起止由 runner 自己发布——一个什么都不调的 setup 也必须可见,不能让「0 running · N queued 长时间不动」看起来像调度卡死:

- **Human(TTY)**:钩子在跑期间,ACTIVE 区为每个在飞的实验钩子显示一行运行级行,排在 attempt 行前面、参与同一套稳定 slot 规则;钩子结束行即消失,成功的钩子不在 scrollback 留任何永久行。钩子里的 `ctx.progress(...)` 只更新这一行的次要文本:

  ```text
  ╭─ niceeval exp compare ──────────────────────────────────────────────── 1m 02s ─╮
  │ 45 total · 6 reused · 3 running · 34 queued · 2 completed                      │
  ├─ ACTIVE ───────────────────────────────────────────────────────────────────────┤
  │ ● experiment setup · compare/bub-e2b               42s  starting tunnel (2/5)  │
  │ ● memory/agent-029-use-cac  compare/codex       1m 18s  editing src/app.ts     │
  ╰──────────────────────────────────────────────────────────────────────── $0.11 ─╯
  ```

- **非 TTY 文本与 `--json`**(只追加的流)没有动态区域,改为起止各追加一行永久事件——长 setup 期间只有心跳的日志无法区分「钩子在跑」和「挂死」。`status` 三值 `started` / `done` / `failed`,`done` / `failed` 带时长;`failed` 只标记钩子本身的结局,每条 attempt 的 `errored`(`experiment-setup-failed`)仍由既有 failure 事件逐条给出。非 TTY 文本用 human 文案(如 `experiment setup · compare/bub-e2b` / `experiment setup done · compare/bub-e2b (42s)`);`--json` 是同一事实的事件:

  ```json
  {"event":"experiment_setup","experimentId":"compare/bub-e2b","status":"started"}
  {"event":"experiment_setup","experimentId":"compare/bub-e2b","status":"done","durationMs":42000}
  ```

- 实验级 `ctx.progress` 与 attempt 级同规则:非 TTY 文本与 `--json` 不逐条输出,也不写入 results。

### 输出流和落盘节奏

动态区域与永久事件必须经过同一个 renderer 排序,不能让底层模块绕开它裸写终端。各形态的流边界固定为:

| 形态 | `stderr` | `stdout` |
|---|---|---|
| 人读文本(TTY) | 计划、永久事件、live 面板 | 最终摘要与结果路径 |
| 人读文本(非 TTY) | 仅启动期用法/配置错误 | 从 start 行到结束摘要的单一有序追加流 |
| `--json` | 仅启动期用法/配置错误 | 从 `start` 到 `result` 的单一有序事件流 |

非交互流(非 TTY 人读文本与 `--json`)不把普通 failure 分流到 `stderr`:两个 OS stream 被 CI runner 或 agent 工具层分开缓冲时会打乱顺序,单流才能保证事件序就是发生序——CI 日志页上失败行与结束摘要因此永远按发生序出现。TTY 人读不受此约束:同一终端设备按写入序交错呈现两个流,live 面板留在 `stderr`,`stdout` 被重定向时仍只拿到最终摘要。只有连形态都没能确定的 argv、配置加载错误走 `stderr`(恒为人读的 `error:` + `fix:` 两行,见[错误与警告反馈](../../error-feedback.md);机器此时靠非零退出码)。

非 TTY 的人读文本使用 human 文案和 human 最终摘要,但运行中退化为“start 一次 + 永久事件 + 空闲 30 秒心跳”的追加流。它不输出 active attempt 的每次阶段变化。

终端反馈不是结果存储。落盘按恢复价值分两类:

- 结果快照逐步增加:调度前创建快照元数据;每个 attempt 完成后原子写入自己的 `result.json` 与已有 artifacts。进程中断时,已经完成的 attempt 仍可读取。
- `--junit <path>` 是整次运行的最终聚合文件:收尾时写临时文件并原子替换目标,不在每个 attempt 后反复重写一个半成品汇总。JSON 聚合不设专用文件出口——重定向 `--json` 事件流,或运行后 `niceeval show --json`,两者都比一份写死形状的汇总文件信息更全。

因此“逐步增加”只发生在 append-only 终端事件和 attempt 级快照;Live 状态只覆盖,最终聚合文件(JUnit)只在完成时出现。

## 人在终端里怎么用

人在终端里通常不需要同时阅读 45 条 attempt 日志。运行中最重要的是全局是否推进、并发槽位在做什么、最近出现了什么问题。

```sh
niceeval exp compare --max-concurrency 19
```

TTY 下 `auto` 选择 `human`。human 的版面只有两种体裁:**面板**是有边界、可整体阅读的区块,画框;**流事件**是一条条追加的过程记录,不画框。

### 框线体裁

框线的几何、嵌套、降级与量测规则单源在[排版原语 · 区域框](../reports/library/layout.md#区域框text-面的框线体裁),`exp` 与 `show` 用同一套,这里只声明 `exp` 特有的部分。

哪些是面板固定为:计划(`PLAN`)、运行中的 live 面板、结束结论(`PASSED` / `FAILED`)、`FAILURES`、`NEXT`(含 `RESULTS` 小节),以及发生留存时的 [`KEPT SANDBOXES`](../sandbox/cli.md#run-收尾输出)。失败行、错误摘要、诊断和运行级瞬时通知是流事件,以无框行追加进 scrollback——它们逐条到达、条数不可预知,而且每条失败最终都会在 `FAILURES` 面板里被再收拢一次。

`exp` 另外还有一个 `show` 没有的维度:live 面板是原地重绘的,不是打印一次。因此——

- 边框吃掉 2 行内容高,可见 active 项数按**内高**计算,不按终端高度。
- live 面板宽度**跟随终端全宽**,不受区域框 100 列上限约束(豁免声明见[排版原语 · 区域框](../reports/library/layout.md#区域框text-面的框线体裁)):它从不进入 scrollback,「阅读宽度」的理由对仪表不成立,宽终端的每一列都该用来显示 attempt 正在做什么。`PLAN`、`FAILURES`、结束面板照旧封顶 100。
- 终端 resize 触发 live 面板整体重绘;这不是状态变化,不放宽[刷新节奏](#什么动态更新什么逐条追加)。
- 上边框的标题是本次命令。命令过长需要截断时保留 `niceeval exp` 和末尾参数、中间补 `…`。
- 色彩只标结论(`PASSED` 绿 / `FAILED` 红),不给边框上色。

### 运行中的 live 面板

计划面板、已经发生的失败留在 scrollback,其下方才是在 `stderr` 原地维护的 live 面板:

```text
╭─ PLAN ─────────────────────────────────────────────────────────────────────────╮
│ 45 attempts · 9 evals × 5 configs · concurrency 19                             │
│ 6 of 45 carried in from cache · 39 to run                                      │
╰────────────────────────────────────────────────────────────────────────────────╯
✗ @1bwcxxiy memory/swelancer-manager-15193 [dev-e2b/claude-e2b]
    gate: Issue 15193: selected proposal matches the accepted proposal
          equals(4) · expected 4 · received 3

╭─ niceeval exp compare ──────────────────────────────────────────────── 2m 14s ─╮
│ 45 total · 6 reused · 19 running · 12 queued · 8 completed                     │
├─ ACTIVE ───────────────────────────────────────────────────────────────────────┤
│ ● memory/agent-029-use-cache  compare/bub-e2b  1m 42s  tool: pnpm vitest run   │
│ ● memory/agent-030-app-route  compare/codex    1m 18s  assistant: editing src… │
│ ● memory/agent-037-tokencap   compare/bub-e2b    54s   creating sandbox        │
│ … 16 more active                                                               │
╰──────────────────────────────────────────────────────────────────────── $0.84 ─╯
```

同一帧在 200 列终端里,身份列宽度不变,detail 段放宽到 ~130 列——adapter 压出的流式预览(完整的 `tool:` 命令行、`assistant:` 消息开头)整段可见,不再被截成几个词。

live 面板只展示当前状态,不保存历史帧:

- 上边框标题是本次命令,右侧嵌已运行时间;下边框右侧嵌本次新派发的累计成本;
- 框内首行固定使用 `total / reused / running / queued / completed`;后四项是互斥状态且总和等于 `total`;
- `ACTIVE` 小节使用稳定 slot:一项完成前不因为其它项更新而换位置,完成后才由下一项补位;实验级 setup / teardown 的运行级行排在 attempt 行前面(见 [实验级钩子的显示](#实验级钩子的显示)),等待 setup 的 attempt 计入 `queued`;
- active 行的列序固定为 `● eval id  experiment  elapsed  phase/detail`。身份两列(eval id、experiment)按**实际出现过的最长值**定宽——短 id 不垫空格,列宽只放宽不回缩(帧间不抖动),各自封顶内容宽的 40% / 20%,超宽截尾补 `…`;剩余宽度**全部**给行尾的 phase/detail——它是这一行存在的理由,任何一帧都不允许 detail 被挤到不可见;
- 行内容按面板实际内容宽排版,与外框用同一个宽度值——不允许出现「行按终端宽排、框按上限截」导致行尾被框吃掉的错位;
- 中间 retry 只改变 active 行尾;失败、错误或 retry 耗尽先撤下整个面板,在上方追加无框流事件,再重建面板;
- 终端变窄时先减少可见项,再截断消息,不能换行撑高面板;面板整体高度不超过终端高度;
- 没有真实状态变化时不重画;历史帧不得进入 scrollback;
- 独立诊断出现时先撤下面板,打印诊断,再在其下方重建。

`PLAN` 面板的复用行只给数量,不把被复用的 eval id 逐条铺进终端——即使全部命中缓存也不展开成 per-config 清单。live 与结束反馈是「回答成败、指向失败」的地方,不是缓存构成的清单;哪些 eval 复用、哪些重跑属于 `--dry`(计划矩阵)与 `niceeval view`(逐结果),不占 human 的 scrollback。

`exp` 的结果反馈按 verdict 穷尽处理：

| Attempt verdict | 运行中永久行 | 结束反馈(`FAILURES` 面板 / `RESULT` block) |
|---|---|---|
| `passed` | 不逐条打印；只更新 live 面板计数 | 只进 passed 汇总，不进入 failures |
| `failed` | locator / eval / experiment + [Scoring 定义的主失败断言摘要](../scoring/library/display.md#契约一结果摘要) | failures 中重复同一摘要，并给 `show @locator` / `--source` 下钻 |
| `errored` | locator / eval / experiment + `error.phase` / code / message | failures 中给同一层错误摘要；cause / stack / diagnostics 下钻 |
| `skipped` | 不冒充失败；只有需要用户行动的 skip 才以 diagnostic 留痕 | 只进 skipped / completion 汇总 |

`received` 常是被测命令的 stdout/stderr，jest / vitest / pytest 几乎总把代码帧、行号、`✕` 用 ANSI 转义着色。这些 ESC 字节在放进摘要行前先剥掉（连同 OSC、裸退格等不可打印控制字节；`✕ › ↓ │` 这类合法符号保留），否则终端会把它重新解释成乱码——尤其被单行截断从转义序列中间切开时。剥控制字节与折单行、截断同属摘要投影，规则单源在 [Scoring · 一条摘要怎样排版](../scoring/library/display.md#一条摘要怎样排版)；两种形态与 `show` / `view` 的比较列表共用这条，捕获输出的着色码不会泄漏进任何终端事实行或 HTML 报告面。`received` 是源码 / 命令输出这类大段原始内容时单独截断一行，不跟 `matcher · expected` 挤在一起，`+N more failures` 也不跟被截断的值粘连：

```text
✗ @1czntzel memory/agent-029-use-cache-directive [codex-gpt-5.6-luna--mempal]
    gate: Catalog reads use use-cache directive and products cache tag
          includes(/['"]use cache['"];?/) · expected matches /['"]use cache['"];?/
          received: // next.config.ts import type { NextConfig } from "next"; c…
+2 more failures
```

只展示一条主失败，其余全部折进这条独立尾行；不得把全部 assertion name 逐条拼进 scrollback。源码不在这里内联，结束反馈给 `show @locator --source`。排版细则见 [Scoring · 一条摘要怎样排版](../scoring/library/display.md#一条摘要怎样排版)。

执行错误即时输出一层可行动摘要,不把 stack 或 provider SDK response 全部灌进 scrollback。摘要固定包含 locator、eval/experiment、正式 phase、稳定 code 和 message:

```text
✗ @12h8m4k1 memory/agent-029-use-cache [compare/claude-e2b] errored · sandbox.create
    sandbox-rate-limit: E2B sandbox allocation failed after 5 attempts
    Inspect: niceeval show @12h8m4k1
```

非致命 diagnostic 使用 warning/error 标记但不冒充 verdict;同一 `dedupeKey` 并发出现时只留一条并显示次数:

```text
! sandbox setup · memory-warmup-degraded (12 attempts)
  Memory warmup failed; continuing with a cold index
```

`niceeval show @12h8m4k1` 展开结构化错误、cause、stack、发生过的阶段与 diagnostics;有 trace 时再用 `--execution` 看执行树。没有 trace 时直接说明 unavailable,不能因此丢失错误详情。

`total` 是选择出的逻辑 attempt 数;`reused` 是缓存携入;`running`、`queued`、`completed` 描述本次需要派发的 attempt。任何一帧都满足 `total = reused + running + queued + completed`,不能出现没有解释的 `Running 39 ... 8/45 done`。

计数口径与成本口径要一致地区分「本次派发」和「缓存携入」。结束反馈第二行的时长是本次运行的真实 wall-clock,tok 与 $ 只统计**本次新派发**的 attempt;reused 携入结果的历史成本不加进这一行,否则会出现「`0s` 却 `$7.04`」这类时长记本次、成本记累计的自相矛盾行。因此 `6 reused + 39 run` 的运行,`1.2M tok · $1.37` 指那 39 次的开销;全部命中缓存、零派发的运行这一行是 `0s · 0 new tok · $0.00`。复用结果各自的原始成本保留在它们的快照里,要看整套结果集(含 reused)的累计成本用 `niceeval view` / `niceeval show`。

### 人看的结束反馈

结束后清除 live 面板,依次打印结论、失败、下一步三个面板。终端不再打印整张 experiment × eval 明细表——大矩阵在 scrollback 里不可读,加了框也不会变得可读,完整对比属于 `niceeval show` / `niceeval view`。`FAILURES` 面板装的是失败清单,不是结果矩阵:

```text
╭─ FAILED ────────────────────────────────────────────────────────────── 3m 48s ─╮
│ 44 passed · 1 failed · 0 errored   (6 reused)                                  │
│ 1.2M tok · $1.37                                                               │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ FAILURES ─────────────────────────────────────────────────────────────────────╮
│ @1bwcxxiy  memory/swelancer-manager-15193  [dev-e2b/claude-e2b]                │
│   gate: Issue 15193: selected proposal matches the accepted proposal           │
│         equals(4) · expected 4 · received 3                                    │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ NEXT ─────────────────────────────────────────────────────────────────────────╮
│ Inspect: niceeval show @1bwcxxiy                                               │
│ Source:  niceeval show @1bwcxxiy --source                                      │
│ Trace:   niceeval show @1bwcxxiy --execution                                   │
│ Diff:    niceeval show @1bwcxxiy --diff                                        │
│ Compare: niceeval view                                                         │
├─ RESULTS ──────────────────────────────────────────────────────────────────────┤
│ .niceeval/compare/bub-e2b/<snapshot>                                           │
│ .niceeval/compare/codex/<snapshot>                                             │
│ … 3 more                                                                       │
╰────────────────────────────────────────────────────────────────────────────────╯
```

结论面板的标题就是结论词,时长嵌在右侧。全部通过时不留空的 `FAILURES` 面板:

```text
╭─ PASSED ────────────────────────────────────────────────────────────── 3m 21s ─╮
│ 45 passed · 0 failed · 0 errored   (0 reused)                                  │
│ 1.1M tok · $1.22                                                               │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ NEXT ─────────────────────────────────────────────────────────────────────────╮
│ Compare: niceeval view                                                         │
├─ RESULTS ──────────────────────────────────────────────────────────────────────┤
│ .niceeval/compare/<5 snapshots>                                                │
╰────────────────────────────────────────────────────────────────────────────────╯
```

#### 全部命中缓存

选择的 attempt 全部可复用时(`running = queued = completed = 0`),没有 attempt 派发,不出 live 面板,`PLAN` 面板之后直接打印结束反馈。复用不改变 verdict 折叠:携入的 `failed` 仍然是 `failed`,照常进 `FAILURES` 并给下钻命令——不能因为「这次没重跑」就把失败藏起来只丢一句计数。结论面板明确「全部来自缓存、本次没有新开销」,后续与普通结束反馈同构;失败条数超过终端展开上限时,总数与展开数嵌进 `FAILURES` 的上边框右侧:

```text
╭─ PLAN ─────────────────────────────────────────────────────────────────────────╮
│ 50 attempts · 10 evals × 5 configs · concurrency 19                            │
│ 50 of 50 carried in from cache · 0 to run                                      │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ FAILED ────────────────────────────────────────────────────────────────── 0s ─╮
│ 33 passed · 17 failed · 0 errored   (all 50 reused)                            │
│ 0 new tok · $0.00                                                              │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ FAILURES ───────────────────────────────────────────── 17 total · showing 10 ─╮
│ @1bwcxxiy  memory/swelancer-manager-15193  [dev-e2b/claude-e2b]                │
│   gate: Issue 15193: selected proposal matches the accepted proposal           │
│         equals(4) · expected 4 · received 1                                    │
│                                                                                │
│ … 9 more failures shown, then:                                                 │
│ +7 more failures — niceeval view                                               │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ NEXT ─────────────────────────────────────────────────────────────────────────╮
│ Inspect: niceeval show @1bwcxxiy                                               │
│ Source:  niceeval show @1bwcxxiy --source                                      │
│ Trace:   niceeval show @1bwcxxiy --execution                                   │
│ Diff:    niceeval show @1bwcxxiy --diff                                        │
│ Compare: niceeval view                                                         │
├─ RESULTS ──────────────────────────────────────────────────────────────────────┤
│ .niceeval/dev-e2b/bub-e2b/<snapshot>                                           │
│ .niceeval/dev-e2b/claude-e2b/<snapshot>                                        │
│ … 3 more                                                                       │
╰────────────────────────────────────────────────────────────────────────────────╯
```

全部命中且全过时同样不列 `FAILURES`,一屏给结论和入口:

```text
╭─ PLAN ─────────────────────────────────────────────────────────────────────────╮
│ 50 attempts · 10 evals × 5 configs · concurrency 19                            │
│ 50 of 50 carried in from cache · 0 to run                                      │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ PASSED ────────────────────────────────────────────────────────────────── 0s ─╮
│ 50 passed · 0 failed · 0 errored   (all 50 reused)                             │
│ 0 new tok · $0.00                                                              │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ NEXT ─────────────────────────────────────────────────────────────────────────╮
│ Compare: niceeval view                                                         │
├─ RESULTS ──────────────────────────────────────────────────────────────────────┤
│ .niceeval/dev-e2b/<5 snapshots>                                                │
╰────────────────────────────────────────────────────────────────────────────────╯
```

选择没有命中任何 eval 时(`total = 0`)不打印空的 `PASSED`,而是明确说无匹配并给可选范围,退出码非零:

```text
No evals selected: dev-e2b matched 0 evals. Available eval prefixes: compare/, dev-e2b/, nightly/.
Run `niceeval exp dev-e2b --dry` to see what it covers, or drop the eval filter to run every eval selected by those experiments.
```

人在调试单条 eval 时仍用相同模型,只是主动收窄选择,而不是要求 live 面板展开更多日志:

```sh
niceeval exp compare/bub-e2b memory/commit0-cachetool --force
niceeval show @17m2k9pq --execution --diff
```

## 机器怎么读:`--json`

一切非交互解析者——coding agent、CI annotation adapter、脚本——共用 `--json`:stdout 上单一有序的 NDJSON 事件流,一行一个 JSON 对象。词法就是 JSON,没有自造 envelope 语法要学;权威接口是退出码、事件里的 locator 与快照,运行结束后的深读一律走 [`niceeval show`](../reports/show.md)(text 或 `--json`)。

```sh
niceeval exp compare --json
```

首行是携带流身份的 `start` 事件;之后只有失败、错误或去重后的 warning 立即追加;若连续 30 秒没有这些永久事件,才追加一条 `progress` 心跳。普通状态变化和 attempt 日志不产生事件:

```json
{"format":"niceeval.exp","schemaVersion":1,"event":"start","total":24,"configs":3,"concurrency":10,"reused":18}
{"event":"progress","elapsedMs":30000,"total":24,"reused":18,"running":6,"queued":0,"completed":0}
{"event":"failure","locator":"@1bwcxxiy","evalId":"memory/swelancer-manager-15193","experimentId":"compare/claude","severity":"gate","assertion":"Issue 15193: selected proposal matches the accepted proposal","matcher":"equals(4)","expected":4,"received":3}
{"event":"error","locator":"@12h8m4k1","evalId":"memory/agent-029-use-cache","experimentId":"compare/claude-e2b","phase":"sandbox.create","reason":"E2B sandbox allocation failed after 5 attempts"}
{"event":"eval","locator":"@12p9k4mz","evalId":"memory/commit0-cachetool","experimentId":"compare/bub-e2b","verdict":"passed","attempts":3,"passed":2}
{"event":"result","status":"failed","passed":22,"failed":1,"errored":1,"reused":18,"completion":"complete","snapshots":[".niceeval/compare/bub-e2b/<snapshot>",".niceeval/compare/claude/<snapshot>",".niceeval/compare/claude-e2b/<snapshot>"]}
```

事件词表:`start` / `progress` / `failure` / `error` / `eval` / `kept` / `warning` / `budget_exhausted` / `reporter_error` / `interrupted` / `experiment_setup` / `experiment_teardown` / `result`。消费方按 `event` 字段分发,忽略未知事件与未知字段;`schemaVersion` 只在破坏性形状变更时递增。

`--json` 固定满足:

- 字段名复用 Results 词表(`locator` / `evalId` / `experimentId` / `phase` / `verdict`),不为事件流发明第二套命名;locator 是继续调查的主键,不能只给 eval id 或第几个 attempt。
- 快照与 attempt artifacts 是权威数据,事件流不是另一份结果 schema——`failure` / `error` 事件只带主失败断言或结构化错误的有界字段,完整证据用 `show` 下钻,脚本消费用 [`show --json`](../reports/show/json.md)。
- `result` 是流的最后一个事件:结论、计数、完成态(`complete` / `incomplete` / `interrupted`)、快照路径与 JUnit 路径(传了 `--junit` 才出现)。逐条失败不在这里重复——流里已经逐事件给过。
- progress 心跳只用于判断进程存活,不是结果数据源;失败或诊断刚写过就重新计时,不紧跟一条冗余心跳。
- reporter 写失败必须判红,因为消费方要求的结果文件缺失不能降级成普通 warning。
- 进程退出码仍是第一层红绿信号,消费方不靠自然语言猜成功。

### 事件与计划文档的 TypeScript 形状

事件流的每一行是下面这个判别联合(判别字段 `event`)之一。只有首事件 `start` 携带 `format` / `schemaVersion` 标识整条流;其余事件不重复这两个字段,`schemaVersion` 只在破坏性形状变更时递增。`phase` 复用 [Results · result.json 的生命周期词表](../results/architecture.md#resultjson)(`LifecyclePhase`),`verdict` 复用同一页的 `AttemptRecord.verdict`,`JsonValue` 复用 [Results · snapshot.json](../results/architecture.md#snapshotjson) 的定义:

```typescript
type LifecyclePhase = /* 见 Results · result.json 的生命周期词表(全仓唯一一套) */ string;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface StartEvent {
  format: "niceeval.exp";
  schemaVersion: number;
  event: "start";
  /** 选中的 attempt 总数。 */
  total: number;
  /** 选中的 experiment(config)数。 */
  configs: number;
  concurrency: number;
  /** 缓存携入、预计不会重新派发的 attempt 数。 */
  reused: number;
}

interface ProgressEvent {
  event: "progress";
  elapsedMs: number;
  total: number;
  reused: number;
  running: number;
  queued: number;
  completed: number;
}

interface FailureEvent {
  event: "failure";
  locator: string;
  evalId: string;
  experimentId: string;
  severity: "gate" | "soft";
  /** 主失败断言的标题。 */
  assertion: string;
  /** matcher / judge 摘要;省略表示这条断言没有摘要文本。 */
  matcher?: string;
  expected?: JsonValue;
  received?: JsonValue;
}

interface ErrorEvent {
  event: "error";
  locator: string;
  evalId: string;
  experimentId: string;
  phase: LifecyclePhase;
  reason: string;
}

interface EvalEvent {
  event: "eval";
  /** 代表 attempt 的定位符:earlyExit 下取 attempt 序号最小的命中通过项,跑满时取序号最大项。 */
  locator: string;
  evalId: string;
  experimentId: string;
  /** 代表 attempt 自身的判定,不是整组折叠判定;题目级结论看 attempts / passed。 */
  verdict: "passed" | "failed" | "skipped" | "errored";
  attempts: number;
  /** 跑满(earlyExit 关)时给出:该 eval 全部已派发 attempt 里通过的计数。 */
  passed?: number;
  /** earlyExit 开时给出:该 eval 原计划的 attempt 总数。 */
  planned?: number;
  /** earlyExit 开时给出:命中终态提前停止后未派发的 attempt 数。 */
  unstarted?: number;
  /** earlyExit 开时给出。 */
  reason?: "early_exit";
}

interface KeptEvent {
  event: "kept";
  locator: string;
  evalId: string;
  attempt: number;
  verdict: "passed" | "failed" | "errored";
  provider: string;
  sandboxId: string;
  /** 进入现场的命令,统一走 `niceeval sandbox enter`。 */
  enter: string;
}

interface WarningEvent {
  event: "warning";
  code: string;
  level: "warning" | "error";
  message: string;
  phase?: LifecyclePhase;
  experimentId?: string;
  /** 同一 dedupeKey 折叠后的出现次数;省略等于 1。 */
  count?: number;
}

interface BudgetExhaustedEvent {
  event: "budget_exhausted";
  experimentId: string;
  spent: number;
  /** 因预算耗尽未派发的 attempt 数。 */
  unstarted: number;
}

interface ReporterErrorEvent {
  event: "reporter_error";
  /** 抛错的 reporter 名。 */
  reporter: string;
  /** 该 reporter 是否 required——true 时写失败让 completion 非 complete、退出码判红。 */
  required: boolean;
  message: string;
}

interface InterruptedEvent {
  event: "interrupted";
}

interface ExperimentSetupEvent {
  event: "experiment_setup";
  experimentId: string;
  status: "started" | "done" | "failed";
  /** status 为 done 或 failed 时给出。 */
  durationMs?: number;
}

interface ExperimentTeardownEvent {
  event: "experiment_teardown";
  experimentId: string;
  status: "started" | "done" | "failed";
  durationMs?: number;
}

interface ResultEvent {
  event: "result";
  /**
   * 结论词:completion 为 "complete" 时是折叠出的 verdict("passed" 或 "failed");
   * completion 非 "complete" 时结论词直接等于 completion 本身(如 budget 耗尽时的
   * "incomplete"),不允许伪装成全绿。
   */
  status: "passed" | "failed" | "incomplete" | "interrupted";
  passed: number;
  failed: number;
  errored: number;
  /** 缓存携入的计数。 */
  reused?: number;
  /** 因 budget 或 fail-fast 未派发的 attempt 数;仅 completion 非 complete 时给出。 */
  unstarted?: number;
  completion: "complete" | "incomplete" | "interrupted";
  snapshots: string[];
  /** 传了 `--junit <path>` 才出现。 */
  junit?: string;
}

type ExpEvent =
  | StartEvent
  | ProgressEvent
  | FailureEvent
  | ErrorEvent
  | EvalEvent
  | KeptEvent
  | WarningEvent
  | BudgetExhaustedEvent
  | ReporterErrorEvent
  | InterruptedEvent
  | ExperimentSetupEvent
  | ExperimentTeardownEvent
  | ResultEvent;
```

`--dry --json` 输出单个 `ExpPlanDocument`,是一次完成的读取,不是事件流:选中的 experiment × eval 矩阵与复用预测一次性给出,`total` / `configs` / `reused` 与 `start` 事件同一口径,`matrix` 逐行给出复用预测;顶层身份字段(`format: "niceeval.exp-plan"`、`schemaVersion`)与事件流的 `start` 事件可区分:

```typescript
interface ExpPlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  /** matrix 行数 × runs。 */
  total: number;
  evals: number;
  configs: number;
  runs: number;
  /** matrix 逐行 reused 之和。 */
  reused: number;
  matrix: ExpPlanRow[];
}

interface ExpPlanRow {
  experimentId: string;
  evalId: string;
  /** 命中缓存指纹,本次不会派发新 attempt。 */
  reused: boolean;
}
```

退出码按 `(experiment, eval)` 的最终 verdict 折叠,两种形态同一套——`0` 全部通过且覆盖完整(complete)、`1` 有 failed / errored 或 incomplete 或 required reporter 写失败、`2` 未捕获崩溃、`130` 中断;语义单源在 [Runner · 退出码](../../runner.md#退出码)。

### AI 常见循环

先看将运行什么:

```sh
niceeval exp compare memory/commit0 --dry --json
```

运行、读取失败 locator、只展开所需证据:

```sh
niceeval exp compare memory/commit0 --json
niceeval show @17m2k9pq
niceeval show @17m2k9pq --execution
```

修复后只重跑受影响项;正常依赖指纹缓存,怀疑缓存口径时才用 `--force`:

```sh
niceeval exp compare/bub-e2b memory/commit0-cachetool --json
niceeval exp compare/bub-e2b memory/commit0-cachetool --json --force
```

agent 也可以完全不解析运行流——跑默认人读文本、只看退出码,失败后直接 `niceeval show` 拿证据;`--json` 是需要在运行中程序化消费(计数、看板、并行编排)时的入口。

### CI 门禁

CI 的权威接口是退出码和结构化文件。日志页给人看,用默认人读文本(非 TTY 自动是只追加流);平台注解走 `--junit`,自建看板在运行后用 `show --json` 聚合:

```sh
NICEEVAL_LANG=en niceeval exp ci \
  --strict \
  --junit .niceeval/junit.xml
niceeval show --json > .niceeval/ci-summary.json   # 需要 JSON 汇总时,读结果面而不是运行流
```

PR 快速门禁,每条只跑一次:

```sh
niceeval exp pr --strict --runs 1 --junit .niceeval/junit.xml
```

夜间稳定性采样,跑满次数而不是首过即停(默认行为,不用额外 flag):

```sh
niceeval exp nightly --strict --runs 5 --junit .niceeval/nightly.xml
```

预算受限的外部模型回归:

```sh
niceeval exp regression --strict --budget 25 --junit .niceeval/regression.xml
```

预算到顶属于“运行未完整覆盖”,结论不能伪装成全绿——人读文本给 warning 行与 `incomplete` 结论,`--json` 给对应事件:

```json
{"event":"budget_exhausted","experimentId":"regression/codex","spent":25.31,"unstarted":4}
{"event":"result","status":"incomplete","passed":36,"failed":0,"errored":0,"unstarted":4,"completion":"incomplete","snapshots":["…"]}
```

## 哪些参数改变什么

输出形态、运行选择和结果出口彼此正交。每个数值参数都有自己的作用域——数字套在哪个单位上,是读懂这张表的关键,尤其是四个调度参数各不相同:

| 类别 | 参数 | 作用域 | 作用 |
|---|---|---|---|
| 形态 | `--json` | 整次调用(仅展示) | 机器面:stdout NDJSON 事件流;不加时为人读文本(TTY live 面板 / 非 TTY 追加流) |
| 选择 | experiment、eval 前缀、`--tag` | 整次调用 | 决定矩阵里有什么 |
| 调度 | `--runs` | 每条 eval | 每条 eval 尝试多少次 |
| 调度 | `--max-concurrency` | 全局并发位(实验级 `maxConcurrency` 闸不参与,见 [Runner · 调度](../../runner.md#调度有界并发)) | 同时运行多少 attempt |
| 调度 | `--timeout` | 每个 attempt | 单次尝试的时间上限 |
| 调度 | `--budget` | 每个 budget 域(experimentId)——选中 N 个实验 = N 份各自独立的上限,不是总闸(见 [Runner · 预算护栏](../../runner.md#预算护栏budget)) | 到顶即停止向该域派发的花费上限 |
| 判定 | `--strict`、`--early-exit` / `--no-early-exit` | 每条 eval 的 verdict | 决定 soft 是否判红、是否跑满 |
| 缓存 | `--force` | 整次调用 | 忽略可复用结果并全部重跑 |
| 执行模式 | [`--keep-sandbox`](../sandbox/cli.md)、[`--reuse-sandbox`](../sandbox/serial-reuse.md) | 整次调用(两者互斥;与缓存携带的交互见 [Runner · 缓存](../../runner.md#缓存指纹去重)) | 留存现场 / 单热道串行复用 |
| 收尾 | `--teardown` | 选中的实验 | 只执行选中实验的实验级 teardown(补救被强杀的运行),不派发 attempt、不跑 setup |
| 预览 | `--dry` | 整次调用 | 只打印计划(人读文本或 `--json` 单文档),不运行、不落盘 |
| 机器出口 | `--junit <path>` | 整次调用 | 额外写 JUnit 聚合文件,不改变形态;JSON 聚合归 `show --json` 或事件流重定向 |

`--junit` 不是终端格式开关,与形态正交——人读文本也可以同时写 JUnit 文件。`--dry` 不创建快照或 JUnit。

### runs 与首过即停怎样展示

`human` 把未派发原因收进动态计数和最终结论,不能留下永久 running 状态;通过本身不追加到 scrollback。未派发的轮次直接从 `queued` 消失、进 `completed`,live 面板的计数行(框内首行)因此始终自洽:

```text
│ 45 total · 6 reused · 18 running · 12 queued · 9 completed                     │
```

开了 `earlyExit`(`--early-exit` 或实验里 `earlyExit: true`)时,`--json` 不伪造两条 skipped attempt,而是在题目级 `eval` 事件中给计数:

```json
{"event":"eval","locator":"@12p9k4mz","evalId":"memory/commit0-cachetool","experimentId":"compare/bub-e2b","verdict":"passed","attempts":1,"planned":3,"unstarted":2,"reason":"early_exit"}
```

默认(earlyExit 关)跑满后使用真实分母:

```json
{"event":"eval","locator":"@12p9k4mz","evalId":"memory/commit0-cachetool","experimentId":"compare/bub-e2b","verdict":"passed","attempts":3,"passed":2}
```

eval 级聚合行的 `locator` 指**代表 attempt**——earlyExit 下取 attempt 序号最小的命中通过项；跑满时取 attempt 序号最大项。选择只依赖落盘身份，不依赖并发完成顺序，因此同一批结果重读恒指向同一个 locator。`verdict` 是这条代表 attempt 自身的判定；题目级聚合结论看 `attempts` / `passed`（以及由两者得到的通过率），不能把代表项的 verdict 当成整组折叠判定。逐 attempt 的 locator 不在聚合行里重复，失败的在 `failure` / `error` 事件里逐条给出，全量用 `niceeval show <eval-id>` 展开。

### timeout、budget 与基础设施错误

两种形态使用同一错误分类,只改变呈现:

```text
人读    ! memory/agent-029  compare/bub-e2b  errored · timeout after 60000ms
--json  {"event":"error","locator":"@18c1m2qx","evalId":"memory/agent-029","experimentId":"compare/bub-e2b","phase":"agent.run","reason":"attempt timed out (60000ms)"}
```

已经发起 agent turn 的 attempt 没有成本数据时只提示一次。人读文本把 warning 永久写入 scrollback,`--json` 追加一条 `warning` 事件;不得每个 attempt 重复同一诊断。attempt 在 `sandbox.create`、setup 等首个 agent turn 之前失败时不产生这条 warning,结构化执行错误是唯一需要置顶的根因。

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

`show` 与 `view` 是顶层命令，不是 `exp` 的子命令。用户误写 `niceeval exp show` 或 `niceeval exp view`，且仓库里没有同名 experiment 时，CLI 保留“不存在的实验”错误，并追加可直接执行的纠错提示：

```text
No experiment matched: show. Available paths: compare/, dev-e2b/, nightly/.
Did you mean: niceeval show
```

如果仓库确实声明了 id 为 `show` 或 `view` 的 experiment，`exp show` / `exp view` 仍按合法 experiment 选择执行，不被命令提示抢占。

用法错误始终写 `stderr` 并非零退出;错误形态不随输出形态改变。`--help` / `--version` 只打印帮助或版本,不加载 experiment、不创建结果。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Library](library.md) —— 路径怎样形成 id，`evals` 怎样选择运行集合。
- [Runner](../../runner.md) —— 矩阵展开、并发、首过即停、预算与退出码。
- [Results](../results/README.md) —— AI 与 CI 应读取的权威快照。
- [CLI 用例](use-case/README.md) —— 每个位置参数与 flag 的用户用例全流程。
