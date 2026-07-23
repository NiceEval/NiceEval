# 断言与 Turn 的展示 —— exp、show 与 view 各显示什么

每条断言评估完都是一条 `AssertionResult`（字段全集见 [Scoring 架构 · 断言记录](../architecture.md#断言记录assertionresult)）；`niceeval exp` 的失败反馈、报告列表、`niceeval show` 与 `niceeval view` 都投影同一条记录，不各自发明字段。本页先定义不同信息密度下该显示多少，再按断言家族给出「记录什么字段 → 显示成什么」的对照示例。

## 两套展示契约

同一批 assertions 只有两种公开投影。二者是不同产品契约，不是同一个组件在窄屏下随意隐藏字段：

| 契约 | 入口 | 目的 | passed attempt | failed / assertion-unavailable attempt |
|---|---|---|---|---|
| **结果摘要** | `exp` 的 Human 永久行与最终 handoff、Agent handoff、CI failure 行；`show` / `view` 的 `ExperimentList`、`EvalList`、`AttemptList` 比较列表 | 先定位哪条 attempt 红、最主要为什么红；计分制额外回答分丢在哪 | 不逐条输出；比较列表 Result 显示 `—`（计分制有丢分时显示首条丢分摘要，见「主失败断言怎样选」） | 只输出一条**主失败断言摘要**，其余失败只报 `+N more failures` |
| **具体诊断与源码** | `show @locator`、view Attempt 详情；`show @locator --source`、view source 模式 | 完整解释全部断言，并把它们放回运行时源码 | Attempt 首页显示 `N passed`，通过项在 view 默认折叠；源码行标 `✓` | failed / soft / unavailable 按声明顺序完整展开；源码行标 `✗` 并紧跟标题、matcher、expected / received 或 reason |

结果摘要里的 `—` 表示“这条 attempt 没有需要解释的失败摘要”，不表示没有 assertions。任何摘要面都不得把 `assertions.map(a => a.name)` 拼进 Result 单元格：这会让通过项比失败项更吵，也会把几十条 matcher 挤成不可读的多行文本。

### 契约一：结果摘要

#### 主失败断言怎样选

“主失败”只是展示投影，不改变 verdict，也不丢弃 `result.json.assertions`：

1. `failed` attempt 先在记录顺序中取第一条 `outcome: "failed"` 的 gate；`--strict` 仅由 soft 失败造成 verdict 时，取第一条促成判定的 soft。
2. assertion unavailable 造成 `errored` 且没有结构化执行 error 时，取第一条非 optional unavailable。
3. 结构化执行 error 优先显示 error 摘要，不拿某条 assertion 冒充根因。
4. 其余同类失败计数为 `+N more failures`；只能在 Attempt 详情展开，不能继续塞进比较列表。

计分制（`defineScoreEval`）在同一套规则上补两条，摘要回答的问题从「为什么红」扩展到「分丢在哪」：

5. 计分制 `failed` 只有前置中止一个来源，规则 1 自然选中中止的那条前置（它是记录顺序最后一条断言、也是唯一 failed 的 gate）；单行摘要照常拼装，不追加中止标注——`⤓` 属于 attempt 详情（见[计分制](#计分制points-与给分记录)），摘要行首的 verdict 已表达「这轮没跑完」。
6. 计分制 `passed` attempt 存在丢分得分点（带 `.points` 的断言 outcome 为 failed，或 `.optional()` 下 unavailable）时，取记录顺序第一条丢分得分点为主摘要，单行尾缀其挣分标注（`… · +0 pts`）；其余丢分得分点计 `+N more lost points`。得分点全部挣满（或没有得分点）时 Result 仍为 `—`。`t.score` 是作者算好条件才给的分，没有「丢」的概念，不进摘要。丢分进摘要的理由：对比场景里「模型 B 只挣 1 分」的下一个问题就是「卡在哪个检查点」，这一格不该只回答红不红——丢分不是失败，但它是这条 attempt 最需要解释的事实。

#### 一条摘要怎样排版

标题取 `groupPath.join(“ > “)`；没有 group 时回退到 `name`。检查方式取 `detail ?? name`，与标题相同时不重复。

短值两行：

```text
gate: Issue 15193: selected proposal matches the accepted proposal
      equals(4) · expected 4 · received 3
```

`received` 是大段原始内容（源码、命令输出、整份文件）时拆成三行，`+N more failures` 独立成尾行：

```text
gate: Catalog reads use use-cache directive and products cache tag
      includes(/['”]use cache['”];?/) · expected matches /['”]use cache['”];?/
      received: // next.config.ts import type { NextConfig } from “next”; c…
+2 more failures
```

检查方式行是标题的悬挂缩进：缩进到 `gate: ` 之后，与标题文字左对齐，让「这条检查叫什么」和「它怎么判的」分成两层。

两个例子共享一条规则：`expected` / `received` 先剥控制字节，再把换行、回车、制表折成单空格。剥控制字节指去除 ANSI 转义序列（CSI 着色 / 光标控制、OSC 及其 payload）与其余不可打印 C0/C1（含裸 ESC、BEL、退格），只保留可打印字符——被测工具（jest / vitest / pytest）几乎总把代码帧、行号、`✕` 着色，这些 ESC 字节不是空白，若原样进任何展示面，终端会把它重新解释成乱码（单行截断从转义序列中间切开时尤其乱），HTML 报告则把 `ESC[2m…ESC[22m` 当字面文本渲染；`✕ ✓ › ❯ ↓ │` 这类工具合法打印的符号在可打印范围内，保留不删。剥净并折单行后（`commandSucceeded()` 的整段 pytest stdout 因此塌成 `exit 1 · “… 2 failed, 14 passed”`，不会几百行铺开），`received` 能并进 `matcher · expected` 那行就并，并不进去就单独截断一行、截断处补 `…`；`+N more failures`（其余同类失败计数，见上「主失败断言怎样选」）不参与截断也不拼进被截断的值——粘在一起会分不清 `…` 后面是值本身还是计数。剥的是展示投影：落盘 `AssertionResult` / artifact 存原始字节，完整证据不失真；落盘的 256 KiB 上限（[Results · 大值截断](../../results/architecture.md#大值截断)）管 artifact 体积，跟这里的展示宽度是两回事。

`exp` 的 Human 永久行/最终 handoff、Agent handoff、CI failure 行用同一套排版。这里的领域标题必须由 eval 作者通过 `t.group(“Issue 15193: …”, fn)`（或断言自身的语义 name）明确提供；renderer 不读取变量名、源码表达式或 prompt 猜标题。没有 group 的原始 `t.check(value, equals(4))` 仍能可靠显示 `equals(4) · expected 4 · received 3`，只是没有足够事实生成 “selected proposal” 这层语义。

#### 单行压缩形态

比较列表（`ExperimentList` / `EvalList` / `AttemptList` 的 Result 单元格）与 [`--history` 时间轴行](../../reports/show/history.md)把同一摘要压成单行。单行语法是上面两行排版的折行拼接，再省掉单行里放不下的冗余，本节是它的单点定义，所有单行面照抄，不各自即兴：

```text
<标题> · <检查方式> · expected <值> · received <值>
```

- 分隔一律 ` · `，关键词后不带冒号；字段有则出现，检查方式与标题相同时省略（同两行排版）。不带 `gate:` 前缀——行首的 verdict 图标已表达严重级。
- 检查方式的参数已写出期望条件时（`equals(4)`、`includes("Brooklyn")`、`calledTool("get_weather")`、`maxCost(0.5)` 这类 matcher 即条件的断言）省 `expected`——重复一遍只挤占宽度；自定义断言给了独立 `expected` 的保留。`received` 连同关键词永不省，它是单行里唯一的新事实：`equals(4) · received 3`、`calledTool("get_weather") · received 0 tool calls`、`commandSucceeded() · received exit 1 · "… 2 failed, 14 passed"`。
- soft 促成判定时以 `<score> / <threshold>` 占值位（`similarity("布鲁克林今天晴。") · 0.71 / 0.90`）；unavailable 促成 `errored` 时以 reason 占值位（`closedQA("修改是否聚焦问题?") · judge-model-unresolved`）；结构化执行 error 显示 error 的一层摘要，不套断言语法。
- 计分制的挣分标注是单行的最后一个尾缀（`commandSucceeded() · received exit 1 · +0 pts`）；`+N more lost points` 与 `+N more failures` 同规则：独立成尾，不参与截断也不拼进被截断的值。
- 宽度不足时先截断语义标题，再截断检查方式，`received` 值与分数最后截断；单个 attempt 的 Result 最多占两行，被 `…` 收口；`+N more failures` 独立，不参与截断也不拼进被截断的值。
- 完整未折行的值在 attempt 首页与 `events.json` / `diff.json` 等 artifact 里，单行面只给能扫读的预览。

CI 单行反馈使用独立结构化字段 `severity=` / `assertion=` / `matcher=` / `expected=` / `received=` / `score=` / `threshold=` / `reason=`；存在什么发什么。Agent checkpoint 只报告 locator 与 verdict，最终 handoff 再使用上面的两层文本。机器消费者因此不需要解析 `gate: ...` 这句 Human 文案。

结果摘要不内联源码。源码回答“这条检查写在哪里、周围代码是什么”，不能替代 expected / received；并发失败时内联还会淹没 scrollback。摘要保留 locator，并在最终 handoff 给出 `niceeval show @locator --source`。

### 契约二：具体诊断与源码

`show @locator` 与 view Attempt 详情消费完整 `AssertionResult[]`，而不是结果摘要里挑出的那一条。它们必须同时提供：

- 顶部计数：passed、gate failed、soft below threshold、unavailable 各多少；计分制 attempt 加一项得分点挣满计数（`2/5 得分点挣满`，见[计分制](#计分制points-与给分记录)）；
- 非 passed 断言的完整展开（show 按声明顺序平铺，view 默认先展开失败项）：每条保留 group、matcher、expected / received、score / threshold、reason 与 `source: file:line:column`；
- passed 收纳：show 只保留计数，view 按 group 默认折叠但可展开全部；计分制的得分点不收纳（[计分制](#计分制points-与给分记录)）；
- 源码入口：`show @locator --source` 与 view source 使用运行时保存的 eval source，在断言调用行标 `✓` / `✗`，行后只附属于该行的断言详情。

源码模式不负责重新判定，也不从源码反推字段；行内标注仍然来自 `AssertionResult.loc` 与同一条结构化记录。没有 source artifact 或 loc 时，Attempt 详情照常显示完整断言，只把源码入口标为 unavailable。

## 通用渲染规则

- **show 的 attempt 首页**（[失败诊断首页](../../reports/show/attempt.md)的 `AttemptSource` / `AttemptAssertions` 区块）按原始声明顺序平铺列出全部非 passed 断言——`✗ gate`（含 `--strict` 下改判的 soft）、`✗ soft`（未达标但不影响 verdict）、`◌ unavailable`（证据评不了，带 reason）混排，不按结果分段；无阈值 judge 的纯打分行没有判定，不算失败也不折进通过计数，同样按声明位置列出分数。挣分标注与给分记录同属「分数可看」：计分制 attempt 的得分点（含 passed）与给分记录始终逐条 / 成块出现。全部通过且无分数可看时不逐条展开，只按 group 折成 `✓ passed · <group> · <count>` 计数行。
- **每条的行格式**：首行 `<状态图标> <severity> · <标题>`（`✗` 失败、`◌` unavailable，纯打分行不带图标）——有 `group` 时标题是分组路径（嵌套用 " > " 拼接），随后 `assertion: <detail>` 行给检查方式；没有分组时标题就是 `name`（即 matcher / judge 摘要），`assertion:` 行与标题重复时省略。之后按有则显示的顺序列 `expected:` / `received:` / `score`（judge 与 soft 带阈值时含 `threshold`）/ `reason:`（仅 unavailable），最后 `source: <loc>`；`expected` / `received` 是短值时可并进检查方式行（无冒号、` · ` 分隔，与[单行压缩形态](#单行压缩形态)同款），长值按键值行展开。
- **view 的 Attempt 详情**保留**全量**断言，但默认先展开 failed / unavailable 与影响判定的 soft，passed 收进按 group 组织的折叠区并在区头显示数量；每条一行（状态图标 + 分组路径 + name + detail + 分数），展开显示 expected / received / `evidence`（这条分数看的材料预览，默认折叠）与源码位置锚（点击跳 `--source` 同款源码视图）；judge 额外画分数条与阈值线；`unavailable` 用独立的第三态样式（非红非绿）标 reason。
- **作用域前缀**：挂在 turn / session 上的断言，`name` 带接收者前缀——turn 断言用[轮标签](#turntsend的展示)（`turn2 · calledTool(...)`），session 断言用会话标签（`session2 · succeeded()`）；挂在 `t` 上的 attempt 级断言无前缀。
- 所有值都是有界预览（截断规则见 [Results · 大值截断](../../results/architecture.md#大值截断)），且展示前都剥控制字节（与契约一同一条规则：去 ANSI 转义与不可打印 C0/C1，保留换行等结构性空白）——`show` 终端面与 view / HTML 报告面都不把捕获输出里的着色码原样渲染；完整原始字节仍在 `events.json` / `diff.json` 等 artifact。

## 值断言

`t.check(t.reply, includes("Brooklyn"))`——`name` = `includes("Brooklyn")`，`expected` = 匹配条件，`received` = 被检查值预览：

```text
✗ gate · includes("Brooklyn")
    expected: contains "Brooklyn"
    received: "It's sunny in Manhattan today, around 24°C…"
    source: evals/weather.eval.ts:12:5
```

`equals(expected)` 给两侧值预览（`expected: 4` / `received: 3`）；`matches(schema)` 的 `received` 是第一条校验错误的路径摘要：

```text
✗ gate · matches(WeatherSchema)
    received: data.temperature: expected number, received string
    source: evals/weather.eval.ts:14:5
```

`similarity(...).atLeast(0.9)` 是 soft 打分，未达标显示分数与阈值：

```text
✗ soft · similarity("布鲁克林今天晴。")   0.71 / 0.90
    received: "今天布鲁克林多云,气温 24 度。"
```

`satisfies(predicate, label)` 与 [自定义断言](custom-assertions.md) 的 `makeAssertion` 都以 `label` / `name` 作标题，`received` 是被检查值预览——谓词本身不可展示，名字就是失败的全部解释，所以必须起有信息量的名字：

```text
✗ gate · 最多 5 条结果
    received: [8 items] [{"id":1,…}, …]
```

`t.check(cmd, commandSucceeded())` 的 `evidence` 是命令行本身，`received` 分两层：首行是退出码加折成单行的输出尾部摘要——stdout 与 stderr 合并后的末尾，因为测试 runner（pytest / vitest）的失败计数都收在最后几行；随后附原样保留换行的更长尾部（`output tail:` 段）。摘要面（比较列表、`--source` 标注）只保留首行；attempt 首页把尾部按原始换行展开。分层的理由：runner 不另存 eval 侧命令的输出，这条记录就是它唯一的家——只存单行摘要等于把「测试到底怎么挂的」这份证据丢掉：

```text
✗ gate · commandSucceeded()
    evidence: pnpm test
    received: exit 1 · "… 2 failed, 14 passed"
      output tail:
      FAILED tests/test_api.py::test_rate_limit - AssertionError: assert 429 == 200
      ========================= 2 failed, 14 passed in 3.41s =========================
```

## 作用域断言

`calledTool` 失败时 `expected` 是匹配条件、`received` 是作用域内实际调用的有界清单——回答「那它到底调了什么」：

```text
✗ gate · turn1 · calledTool("get_weather", { input: { city: "Brooklyn" } })
    expected: ≥1 call matching input.city = "Brooklyn"
    received: 2 tool calls: get_weather({"city":"SF"}) · get_time({})
```

**负断言失败要给反例定位**：`notCalledTool` / `notEvent` 的 `received` 指出命中的那一次（第几轮、事件序号、入参预览），view 里点击直接跳到事件流对应卡片：

```text
✗ gate · notCalledTool("bash", { input: { command: /npm i/ } })
    received: matched at turn2 · action#5 · bash({"command":"npm install lodash"})
```

`toolOrder` / `eventOrder` 的 `received` 是实际顺序摘要，标出首个违反点：

```text
✗ gate · toolOrder(["read_file", "write_file"])
    received: write_file → read_file (write_file appeared before any read_file)
```

上限断言显示上限与实测合计；`maxTokens` / `maxCost` 依赖 usage 通道：

```text
✗ gate · maxCost(0.5)
    expected: ≤ $0.50
    received: $0.83 (3 turns)
```

`succeeded()` / `parked()` 的 `received` 是作用域末态摘要（`turn status: failed` / `1 unanswered input request`）；`messageIncludes(token)` 与 `includes` 同款，`received` 是 assistant 文本预览；`eventsSatisfy(label, predicate)` 以 `label` 为标题，`received` 固定为事件流规模摘要（`38 events in scope`）——谓词不透明，解释责任在 label。

## Judge

无阈值 judge 是纯打分，没有判定图标，按声明位置列出分数；`evidence` 是裁判实际收到的材料预览（view 里默认折叠展开看）：

```text
soft · closedQA("修改是否聚焦问题?")   0.82
```

`.atLeast(x)` 未达标同 soft 打分格式（`✗ soft · … 0.58 / 0.70`）；`.gate(x)` 失败按 gate 展示：

```text
✗ gate · closedQA("diff 是否只修改目标逻辑?")   0.40 / 0.70
    evidence: (on: t.sandbox.diff.get("src/weather.ts")) "@@ -12,6 +12,9 @@ …"
    source: evals/refactor.eval.ts:21:3
```

judge 没有解析到模型 / key 时记 `unavailable`（[判定规则](../architecture/severity-and-verdict.md#证据不可用unavailable不折叠成通过)：非 `.optional()` 的断言评不了 → attempt `errored`）：

```text
◌ gate · closedQA("修改是否聚焦问题?")
    reason: judge-model-unresolved (no model in config, NICEEVAL_JUDGE_MODEL unset)
```

## Sandbox 断言

`fileChanged` / `fileDeleted` / `notInDiff` 断的是 [agent 归因增量](../../sandbox/architecture.md#变更归因send-窗口与分类账)，失败信息要能区分「agent 没改」与「文件只被 eval 侧写入」：

```text
✗ gate · fileChanged("src/legacy.js")
    expected: changed by agent in some send window
    received: not changed in any of 2 send windows (file exists; written outside send windows)
```

`notInDiff(re)` 失败给命中文件与行预览；`noFailedShellCommands()` 失败给失败命令与退出码——都与 view 的 diff / 事件视图同源，view 里可点进对应文件 diff：

```text
✗ gate · notInDiff(/console\.log/)
    received: matched in src/app.ts:47 "console.log(debugPayload)"
```

## 证据缺口的 unavailable

负断言与上限断言在所需证据通道非 complete（含 unknown）时记 `unavailable` 并给通道原因；正断言在非 complete 通道上没找到匹配同样是 `unavailable`，不是 failed（[EvidenceCoverage](../../adapters/architecture/evidence.md#覆盖声明evidencecoverage)）。view 在 Attempt 详情顶部同时显示 coverage 徽标；带 `.optional()` 的条目额外标 `optional`，说明它不影响判定：

```text
◌ gate · notCalledTool("bash")
    reason: coverage:actions=partial (adapter only captures successful actions)
◌ soft · optional · closedQA("文风是否友好?")
    reason: judge-model-unresolved
```

## 分组

`t.group` 嵌套体现在标题的分组路径上，view 里同组断言折叠在同一个分组块下：

```text
✗ gate · 天气查询 > 城市解析
    assertion: equals("Brooklyn")
    expected: "Brooklyn"
    received: "Manhattan"
    source: evals/weather.eval.ts:31:7
```

## 计分制：`.points` 与给分记录

计分制（`defineScoreEval`）eval 的两种给分痕迹都要能在 attempt 详情里看到，不只在报告的总分列汇总——`show @locator` 与 view Attempt 详情都消费同一份 `AssertionResult[]` / `ScoreEntry[]`，不另建一套计分展示。

**`.points(n)` 挂在断言上**：该断言无论 passed / failed 都在原有行尾追加一个挣分标注，与其它尾缀同一套 ` · ` 分隔规则；标注的是**挣到的分**（`n × score`），不是声明的 `n`——失败的检查点显示 `+0 pts`，不隐藏、不伪造成满分；连续打分断言按比例显示（如 `.points(20)` 挣 0.8 分显示 `+16 pts`）：

```text
✓ passed · 装了依赖
    +1 pt
✗ soft · 健康检查可达
    expected: exit 0
    received: exit 1
    +0 pts
```

得分点的 severity 是 `soft`——丢分不改 verdict（[计分粒度](../../experiments/score-points.md#计分制叠加给分没有上限声明)），失败行照常展开证据。

**得分点不参与 passed 收纳**：`✓ passed · 装了依赖 · +1 pt` 是分数面的证据，挣到的分和丢掉的分同样要能逐条核对——把它折进 `✓ passed · <group> · <count>` 计数行，等于让判定面的收纳规则吞掉分数面的明细。收纳只作用于不带 `.points` 的观测断言。契约二的顶部计数在计分制 attempt 加一项**得分点挣满计数**（`2/5 得分点挣满`，挣满 = 挣到全部声明分值，连续打分断言不足 `n × 1.0` 即不算挣满）；**本轮挣分总和只在 attempt 头行出现一次**（`AttemptSummary` 的总分位，见 [Attempt 详情组件](../../reports/library/attempt-detail.md#公开组件集)），计数行与给分记录区块不重复这个总数。

**前置中止**：计分制里链了 `.gate()` 的断言挂掉会就地结束 `test()`，它按 `✗ gate` 展开，行尾追加一个中止标注，其后不再有任何断言或给分记录——详情里「后面是空的」和「后面全挂了」因此一眼可分：

```text
✗ gate · db-gpt cloned
    expected: true
    received: false
    ⤓ 前置未过,test() 就地结束
```

**`t.score(label, n)` 的直接给分记录**：与断言分属两个数组（见 [Scoring 架构 · 断言记录](../architecture.md#断言记录assertionresult)），没有 severity、没有 outcome，不与 assertions 混排；展示时单独成一个「给分记录」区块，按 `groupPath` 分组（与 passed 断言同一套 `groupPath.join(" > ")` 分组算法，无分组归到同一个空键），组内保持记录顺序：

```text
给分记录 · 2
  代码质量 · 2
    代码精简 · +15 pts
    重构说明 · +16 pts
```

**源码面同样承载给分证据**：有源码时（`show @locator --source`、view 的 `AttemptSource`）给分证据不换家也不消失——得分点的挣分标注进源码行右缘的分数 pill，`t.score(...)` 调用行原位标注给分，前置中止行带 `⤓` 且其后的源码行整体降灰，「没写断言的行」和「没跑到的行」在源码面同样一眼可分；`loc` 不在展示源码内的得分点与给分记录落在源码块后的 unmapped 区，给分记录仍按 `groupPath` 分组。视觉细则单点在 [Attempt 详情组件 · `AttemptSource` 视觉规范](../../reports/library/attempt-detail.md#attemptsource-web-面视觉规范)。

通过制（`scoring` 省略或 `"pass"`）eval 的 attempt 恒没有 `.points` 挣分与给分记录——两者在通过制 attempt 上零输出，不摆空区块；计分制 eval 没有 `t.score` 调用时同样不渲染「给分记录」区块。

## Turn（`t.send()`）的展示

一次 `t.send()` 产生一个 Turn，它自己有五样要展示的东西：**身份**（轮标签，见下）、**status**（completed / failed / waiting）、**事件流**（这一轮的对话与工具卡片）、**usage**（这一轮的 token / 成本）、**`turn.data`**（结构化输出，如果 Adapter 给了）。语法契约在 [Show](../../reports/show.md) 与 [View](../../reports/view.md)，这里给对照示例。

**轮标签**是本节的单点定义，别处只引用：主会话（`t.send`）的第 N 轮是 `turn<N>`（`turn1`、`turn2`……）；`t.newSession()` 开的会话按创建序编号——主会话是会话 1，新会话从 2 起——其轮是 `session<K>/turn<N>`（如 `session2/turn1`），轮次在各自会话内计数。标签用完整单词，第一次读输出的人不需要图例就能读懂；主会话不带前缀，与「`t.send()` 是主线、`t.newSession()` 是额外会话」的 API 形态一一对应。同一枚 token 原样出现在 `--execution` 的轮头行、`--timing` 的 turn 节点、`--source` 的 send 标注、`--diff` / `diff.json` 的 `windows` 与 [`sandbox history` / `diff`](../../sandbox/cli.md#回放留存现场的变更历史sandbox-history--diff)，复制进 `--window` 也是它。标签是不透明字符串：跨面对照按字符串等值，消费方不解析它的内部结构。

**show 首页 `execution:` 行**——整个 attempt 的事件计数，一行看规模：

```text
execution: 12 events · 0 skill loads · 7 tool calls · 4 AI messages
```

**`show --execution`**——按轮分段：每轮以 **turn 头行**开始，头行首列就是轮标签（标签 · status · 该轮墙钟 · 该轮 usage），轮内是时间线卡片（USER / ASSISTANT / TOOL / SKILL / SUBAGENT），工具卡片带 input 与 result。多轮、多 session 的边界因此不用数消息猜：

```text
turn1 · completed · 22.4s · 12.4k tok · $0.02
  USER
    把部署脚本改成蓝绿发布。

  ASSISTANT
    I'll update the deploy script and ask for confirmation before applying.

  TOOL · shell  +8.2s · 1.1s
    input
      /bin/bash -lc 'cat deploy.sh'
    result · completed · exit 0
      #!/usr/bin/env bash …

turn2 · waiting · 3.1s · 1.8k tok
  ASSISTANT
    Ready to apply. Confirm?

  INPUT REQUESTED · action=deploy
    prompt: Apply blue-green deployment to production?
    options: approve · deny
```

`waiting` 轮以输入请求卡片收尾，`action` / `prompt` / `options` 正是 `t.requireInputRequest` 能过滤的字段；`failed` 轮在头行标 `failed` 并以错误卡片收尾（Turn failed 不等于 attempt errored，见 [Severity 与 Verdict](../architecture/severity-and-verdict.md)）。Adapter 给了 `turn.data` 时，该轮末尾追加 DATA 卡片（有界 JSON 预览），`outputEquals` / `outputMatches` 失败时 `received` 引用的就是它：

```text
  DATA
    { "city": "Brooklyn", "temperature": 24, "condition": "sunny" }
```

**`show --timing`**——每轮是 `eval.run` 下以轮标签命名的节点，记 send 的墙钟包络；该轮带 `traceId` 时向下挂接 agent / model / tool spans。`--execution` 回答「这一轮做了什么」，`--timing` 回答「这一轮慢在哪」，标签同源可互相对照：

```text
eval.run              26.3s
  ├─ turn1                22.4s
  │    ├─ agent · codex run             21.9s
  │    │    ├─ model · gpt-5.4 call #1   6.3s
  │    │    └─ tool · shell              1.1s
  └─ turn2                 3.1s
```

**`show --source`**——`t.send(...)` 的调用行标注该轮的头行事实（身份、status、墙钟与 usage——有记录才出现），失败轮标 `✗`；不内联回复与工具卡片，语法契约见 [Show · --source](../../reports/show/eval-source.md)：

```text
27✓       .send("Implement `run_tasks` in `run.py`. …")
    turn1 · completed · 3m 11s
```

**view Attempt 详情**——对话区与 `--execution` 同一分轮卡片语法并挂接 trace；每个 turn 头行可折叠。Turn 的 `coverage` 相对 Agent 默认降级时，该轮头部显示证据徽标，与 `unavailable` 断言的 reason 同源：

```text
turn2 · completed · evidence: actions partial — stream reconnected mid-turn
```

**agent diff 的轮次归属**——`show --diff` 与 `diff.json` 的 `windows` 字段用同一枚轮标签标出每个文件是哪几轮改的（见 [diff.json](../../results/architecture.md#diffjson)），从「这轮说了什么」到「这轮改了什么」双向可对。

## 相关阅读

- [Scoring 架构 · 断言记录](../architecture.md#断言记录assertionresult) —— 字段全集的单点定义。
- [Severity 与 Verdict](../architecture/severity-and-verdict.md) —— 各状态怎么折叠成判定。
- [Show](../../reports/show.md) / [View](../../reports/view.md) —— 宿主页面布局与其它证据切面。
