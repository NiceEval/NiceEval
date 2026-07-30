# Assertion 与 Turn 的展示 —— exp、show 与 view 各显示什么

每条断言评估完都是一条 `AssertionResult`，字段全集见 [Assertions 架构 · 断言记录](../architecture.md#断言记录assertionresult)。
`niceeval exp` 的失败反馈、报告列表、`niceeval show` 与 `niceeval view` 都投影同一条记录，不各自发明字段。
本页先定义不同信息密度下该显示多少，再按断言家族给出「记录什么字段 → 显示成什么」的对照示例。

## 两套展示契约

同一批 assertions 只有两种公开投影。
二者是不同产品契约，不是同一个组件在窄屏下随意隐藏字段：

| 契约 | 入口 | 目的 | passed attempt | failed / assertion-unavailable attempt |
|---|---|---|---|---|
| **结果摘要** | `exp` 的人读永久行与 `FAILURES` 面板、`--json` 的 `failure` 事件；`show` / `view` 的 `ExperimentList`、`EvalList`、`AttemptList` 比较列表 | 先定位哪条 attempt 红、最主要为什么红；计分制额外回答分丢在哪 | 不逐条输出；比较列表 Result 显示 `—`（计分制有丢分时显示首条丢分摘要，见「主失败断言怎样选」） | 只输出一条**主失败断言摘要**，其余失败只报 `+N more failures` |
| **具体诊断与源码** | `show @locator`、view Attempt 详情；`show @locator --source`、view source 模式 | 完整解释全部断言，并把它们放回运行时源码 | Attempt 首页显示 `N passed`，通过项在 view 默认折叠；源码行标 `✓` | failed / soft / unavailable 按声明顺序完整展开；源码行标 `✗` 并紧跟标题、matcher、expected / received 或 reason |

结果摘要里的 `—` 表示“这条 attempt 没有需要解释的失败摘要”，不表示没有 assertions。
任何摘要面都不得把 `assertions.map(a => a.name)` 拼进 Result 单元格：这会让通过项比失败项更吵，也会把几十条 matcher 挤成不可读的多行文本。

### 契约一：结果摘要

#### 主失败断言怎样选

“主失败”只是展示投影，不改变 verdict，也不丢弃 `result.json.assertions`：

1. `failed` attempt 先在记录顺序中取第一条 `outcome: "failed"` 的 gate；`--strict` 仅由 soft 失败造成 verdict 时，取第一条促成判定的 soft。
2. assertion unavailable 造成 `errored` 且没有结构化执行 error 时，取第一条非 optional unavailable。
3. 结构化执行 error 优先显示 error 摘要，不拿某条 assertion 冒充根因。
4. 其余同类失败计数为 `+N more failures`；只能在 Attempt 详情展开，不能继续放入比较列表。

计分制（`defineScoreEval`）在同一套规则上补两条，摘要回答的问题从「为什么红」扩展到「分丢在哪」：

5. 计分制 `failed` 只有前置中止一个来源。
   规则 1 自然选中中止的前置；它是记录顺序最后一条断言，也是唯一 failed 的 gate。
   单行摘要照常拼装，不追加中止标注。
   `⤓` 属于 Attempt 详情，见[计分制](#计分制points-与给分记录)；摘要行首的 Verdict 已表达「这轮没跑完」。
6. 计分制 `passed` Attempt 可能存在丢分得分点，包括带 `.points` 的 failed 断言和 `.optional()` 下的 unavailable。
   此时取记录顺序第一条丢分得分点为主摘要，单行尾缀其挣分标注（`… · +0 pts`）。
   其余丢分得分点计 `+N more lost points`。
   得分点全部挣满或没有得分点时，Result 仍为 `—`。
   `t.score` 是作者算好条件才给的分，没有「丢」的概念，不进摘要。
   丢分需要进入摘要：对比场景里「模型 B 只挣 1 分」的下一个问题就是「卡在哪个检查点」。
   这一格不该只回答红不红。
   丢分不是失败，但它是这条 Attempt 最需要解释的事实。

#### 一条摘要怎样排版

标题取 `groupPath.join(“ > “)`；没有 group 时回退到 `name`。
检查方式取 `detail ?? name`，与标题相同时不重复。

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

两个例子共享一条规则：`expected` / `received` 先剥控制字节，再把换行、回车、制表折成单空格。
控制字节包括 ANSI 转义序列与其余不可打印 C0/C1。
ANSI 包括 CSI 着色、光标控制、OSC 及其 payload；C0/C1 包括 ESC、BEL 与退格。

被测工具几乎总把代码帧、行号与 `✕` 着色。
这些 ESC 字节不是空白；原样进入终端会被重新解释成乱码，在单行截断从转义序列中间切开时尤其明显。
HTML 报告则会把 `ESC[2m…ESC[22m` 当字面文本渲染。
`✕ ✓ › ❯ ↓ │` 这类合法可打印符号保留不删。

剥净并折单行后，`received` 能并进 `matcher · expected` 行就合并，否则单独截断一行并补 `…`。
例如，`commandSucceeded()` 的整段 pytest stdout 会折成 `exit 1 · “… 2 failed, 14 passed”`。
`+N more failures` 不参与截断，也不拼进被截断的值；否则无法判断 `…` 后面是值还是计数。

剥控制字节只改变展示投影。
落盘 `AssertionResult` 与 artifact 保存原始字节，完整证据不失真。
落盘的 256 KiB 上限只管 artifact 体积，见 [Results · 大值截断](../../record/architecture.md#大值截断)；它与展示宽度无关。

`exp` 的人读永久行 / `FAILURES` 面板与 `--json` `failure` 事件的文本字段用同一套排版。
这里的领域标题必须由 eval 作者通过 `t.group(“Issue 15193: …”, fn)`（或断言自身的语义 name）明确提供；renderer 不读取变量名、源码表达式或 prompt 猜标题。
没有 group 的原始 `t.check(value, equals(4))` 仍能可靠显示 `equals(4) · expected 4 · received 3`，只是没有足够事实生成 “selected proposal” 这层语义。

#### 单行压缩形态

比较列表（`ExperimentList` / `EvalList` / `AttemptList` 的 Result 单元格）与 [`--history` 时间轴行](../../reports/show/history.md)把同一摘要压成单行。
单行语法是上面两行排版的折行拼接，再省掉单行里放不下的冗余，本节是它的单点定义，所有单行面照抄，不各自即兴：

```text
<标题> · <检查方式> · expected <值> · received <值>
```

- 分隔一律 ` · `，关键词后不带冒号；字段有则出现，检查方式与标题相同时省略（同两行排版）。
  不带 `gate:` 前缀——行首的 verdict 图标已表达严重度。
- 检查方式的参数已写出期望条件时，省略重复的 `expected`。
  这适用于 `equals(4)`、`includes("Brooklyn")`、`calledTool("get_weather")`、`maxCost(0.5)` 这类 matcher 即条件的断言。
  自定义断言给了独立 `expected` 时保留。
- `received` 连同关键词永不省，它是单行里唯一的新事实。
  典型形态包括 `equals(4) · received 3` 与 `calledTool("get_weather") · received 0 tool calls`。
  命令结果可写成 `commandSucceeded() · received exit 1 · "… 2 failed, 14 passed"`。
- soft 促成判定时以 `<score> / <threshold>` 占值位（`similarity("布鲁克林今天晴。") · 0.71 / 0.90`）；unavailable 促成 `errored` 时以 reason 占值位（`closedQA("修改是否聚焦问题?") · judge-model-unresolved`）；结构化执行 error 显示 error 的一层摘要，不套断言语法。
- 计分制的挣分标注是单行的最后一个尾缀（`commandSucceeded() · received exit 1 · +0 pts`）；`+N more lost points` 与 `+N more failures` 同规则：独立成尾，不参与截断也不拼进被截断的值。
- 宽度不足时先截断语义标题，再截断检查方式，`received` 值与分数最后截断；单个 attempt 的 Result 最多占两行，被 `…` 收口；`+N more failures` 独立，不参与截断也不拼进被截断的值。
- 完整未折行的值在 attempt 首页与 `events.json` / `diff.json` 等 artifact 里，单行面只给能扫读的预览。

`--json` 的 `failure` 事件使用独立结构化字段 `severity` / `assertion` / `matcher` / `expected` / `received` / `score` / `threshold` / `reason`；存在什么发什么。
机器消费者因此不需要解析 `gate: ...` 这句 Human 文案。

结果摘要不内联源码。
源码回答“这条检查写在哪里、周围代码是什么”，不能替代 expected / received；并发失败时内联还会淹没 scrollback。
摘要保留 locator，并在人读结束反馈（`FAILURES` / `NEXT` 面板）给出 `niceeval show @locator --source`。

### 契约二：具体诊断与源码

`show @locator` 与 view Attempt 详情消费完整 `AssertionResult[]`，而不是结果摘要里挑出的那一条。
它们必须同时提供：

- 顶部计数：passed、gate failed、soft below threshold、unavailable 各多少；计分制 attempt 加一项得分点挣满计数（`2/5 得分点挣满`，见[计分制](#计分制points-与给分记录)）；
- 非 passed 断言的完整展开（show 按声明顺序平铺，view 默认先展开失败项）：每条保留 group、matcher、expected / received、score / threshold、reason 与 `source: file:line:column`；
- passed 收纳：show 只保留计数，view 按 group 默认折叠但可展开全部；计分制的得分点不收纳，见[计分制](#计分制points-与给分记录)；
- 源码入口：`show @locator --source` 与 view source 使用运行时保存的 eval source，在断言调用行标 `✓` / `✗`，行后只附属于该行的断言详情。

源码模式不负责重新判定，也不从源码反推字段；行内标注仍然来自 `AssertionResult.loc` 与同一条结构化记录。
没有 source artifact 或 loc 时，Attempt 详情照常显示完整断言，只把源码入口标为 unavailable。

## 通用渲染规则

- **show 的 Attempt 首页**使用[失败诊断首页](../../reports/show/attempt.md)的 `AttemptSource` 与 `AttemptAssertions` 区块。
  它按原始声明顺序平铺全部非 passed 断言，不按结果分段。
- **状态行**区分 `✗ gate`、`✗ soft` 与 `◌ unavailable`。
  无阈值 Judge 没有判定，不算失败也不折进通过计数；它仍按声明位置列出分数。
- **分数证据**始终可看。
  计分制 Attempt 的得分点与给分记录逐条或成块出现；得分点包括 passed 项。
  全部通过且无分数可看时，只按 group 折成 `✓ passed · <group> · <count>` 计数行。
- **每条的首行**是 `<状态图标> <severity> · <标题>`。
  `✗` 表示失败，`◌` 表示 unavailable，纯打分行不带图标。
  有 `group` 时标题是用 " > " 拼接的分组路径，随后用 `assertion: <detail>` 给出检查方式。
  没有分组时，标题就是 matcher / Judge 摘要。
- **详情字段**按 `expected:`、`received:`、`score`、`reason:`、`source: <loc>` 排列，存在才显示。
  `assertion:` 与标题重复时省略。
  Judge 与 soft 带阈值时，`score` 同时显示 `threshold`；`reason:` 仅用于 unavailable。
  短 `expected` / `received` 可并进检查方式行，长值按键值行展开。
- **view 的 Attempt 详情**保留**全量**断言，但默认先展开 failed、unavailable 与影响判定的 soft。
  passed 收进按 group 组织的折叠区，并在区头显示数量。
  每条用一行显示状态图标、分组路径、name、detail 与分数。
  展开后显示 expected、received、默认折叠的 `evidence`，以及可跳到源码视图的位置锚。
  Judge 额外画分数条与阈值线。
  `unavailable` 使用非红非绿的第三态样式标 reason。
- **作用域前缀**：挂在 turn / session 上的断言，`name` 带接收者前缀。
  turn 断言使用 [轮标签](#turntsend的展示)，例如 `turn2 · calledTool(...)`；session 断言使用会话标签，例如 `session2 · succeeded()`。
  挂在 `t` 上的 Attempt 级断言无前缀。
- 所有值都是有界预览，截断规则见 [Results · 大值截断](../../record/architecture.md#大值截断)。
  展示前按契约一的规则剥控制字节：去除 ANSI 转义与不可打印 C0/C1，保留换行等结构性空白。
  `show`、view 与 HTML 报告都不原样渲染捕获输出里的着色码。
  完整原始字节仍保存在 `events.json`、`diff.json` 等 artifact 中。

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

`t.check(cmd, commandSucceeded())` 的 `evidence` 是命令行本身，`received` 分两层。
首行是退出码加折成单行的输出尾部摘要，取 stdout 与 stderr 合并后的末尾。
合并按 stderr 在前、stdout 在后：包装器的装包与进度噪声按惯例流到 stderr 且发生在被测命令之前，测试 runner 的失败计数收在 stdout 最后几行——这个顺序让合并后的末尾落在结论上，不落在噪声上。
只有一条流有内容时顺序不产生差别。
随后附上原样保留换行的更长 `output tail:` 段。

摘要面只保留首行，包括比较列表与 `--source` 标注；Attempt 首页按原始换行展开尾部。
runner 不另存 eval 侧命令输出，这条记录是它唯一的归属。
只存单行摘要会丢失「测试到底怎么挂的」证据：

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

`succeeded()` / `parked()` 的 `received` 是作用域末态摘要，例如 `turn status: failed` 或 `1 unanswered input request`。
`messageIncludes(token)` 与 `includes` 同款，`received` 是 assistant 文本预览。
`eventsSatisfy(label, predicate)` 以 `label` 为标题，`received` 固定为事件流规模摘要，例如 `38 events in scope`。
谓词不透明，解释责任在 label。

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

Judge 没有解析到模型 / key 时记 `unavailable`。
非 `.optional()` 的断言评不了会使 Attempt `errored`，见[判定规则](../../verdict/architecture.md#证据不可用unavailable不折叠成通过)：

```text
◌ gate · closedQA("修改是否聚焦问题?")
    reason: judge-model-unresolved (no judge model in the eval or project config)
```

## Sandbox 断言

`fileChanged` / `fileDeleted` / `notInDiff` 检查 [Agent 归因增量](../../sandbox/architecture.md#变更归因send-窗口与分类账)。
失败信息要能区分「Agent 没改」与「文件只被 Eval 侧写入」：

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

负断言与上限断言在所需证据通道非 complete（含 unknown）时记 `unavailable`，并给出通道原因。
正断言在非 complete 通道上没找到匹配时同样是 `unavailable`，不是 failed，见 [EvidenceCoverage](../../adapters/architecture/evidence.md#覆盖声明evidencecoverage)。
view 在 Attempt 详情顶部同时显示 coverage 徽标。
带 `.optional()` 的条目额外标 `optional`，说明它不影响判定：

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

计分制（`defineScoreEval`）Eval 的两种给分痕迹都要能在 Attempt 详情里看到，不能只在报告总分列汇总。
`show @locator` 与 view Attempt 详情消费同一份 `AssertionResult[]` / `ScoreEntry[]`，不另建计分展示。

**`.points(n)` 挂在断言上**：该断言无论 passed / failed 都在原有行尾追加挣分标注，与其它尾缀使用同一套 ` · ` 分隔规则。
标注的是**挣到的分**（`n × score`），不是声明的 `n`。
失败的检查点显示 `+0 pts`，不隐藏也不伪造成满分。
连续打分断言按比例显示；例如 `.points(20)` 挣 0.8 分时显示 `+16 pts`：

```text
✓ passed · 装了依赖
    +1 pt
✗ soft · 健康检查可达
    expected: exit 0
    received: exit 1
    +0 pts
```

得分点的 severity 是 `soft`——丢分不改 verdict（[计分粒度](score-points.md#计分制叠加给分没有上限声明)），失败行照常展开证据。

**得分点不参与 passed 收纳**：`✓ passed · 装了依赖 · +1 pt` 是分数面的证据。
挣到的分和丢掉的分都要能逐条核对。
把它折进 `✓ passed · <group> · <count>` 计数行，会让判定面的收纳规则吞掉分数明细。
收纳只作用于不带 `.points` 的观测断言。

契约二的顶部计数在计分制 Attempt 增加**得分点挣满计数**，例如 `2/5 得分点挣满`。
挣满表示挣到全部声明分值；连续打分断言不足 `n × 1.0` 就不算挣满。
**本轮挣分总和只在 Attempt 头行出现一次**，位于 `AttemptSummary` 的总分位，见 [Attempt 详情组件](../../reports/components/attempt-detail/README.md#公开区块集)。
计数行与给分记录区块不重复这个总数。

**前置中止**：两种题型里链了 `.stopOnFailure()` 的断言挂掉会就地结束 `test()`；若同时是 gate，按 `✗ gate` 展开，行尾追加一个中止标注，其后不再有任何断言或给分记录——详情里「后面是空的」和「后面全失败」因此一眼可分：

```text
✗ gate · db-gpt cloned
    expected: true
    received: false
    ⤓ stopOnFailure: test() 就地结束
```

**`t.score(label, n)` 的直接给分记录**与断言分属两个数组，见 [Assertions 架构 · 断言记录](../architecture.md#断言记录assertionresult)。
它没有 severity 与 outcome，不与 assertions 混排。
展示时单独形成「给分记录」区块，并按 `groupPath` 分组。
分组算法与 passed 断言相同，使用 `groupPath.join(" > ")`；无分组归到同一个空键。
组内保持记录顺序：

```text
给分记录 · 2
  代码质量 · 2
    代码精简 · +15 pts
    重构说明 · +16 pts
```

**源码面同样承载给分证据**：有源码时（`show @locator --source`、view 的 `AttemptSource`），得分点的挣分标注进源码行右缘的分数 pill，`t.score(...)` 调用行原位标注给分，前置中止行带 `⤓` 且其后源码行整体降灰。
共享 helper 中的给分证据进入源码调用片段；有位置但缺正文时显示 unavailable 缺口。
只有没有 `loc` 的得分点与给分记录进入 unmapped，给分记录仍按 `groupPath` 分组。
视觉细则单点在 [Attempt 详情组件](../../reports/components/primitives/source-view.md#web-面视觉规范) 定义 `AttemptSource` 的视觉规范。

通过制（`scoring` 省略或 `"pass"`）eval 的 attempt 恒没有 `.points` 挣分与给分记录——两者在通过制 attempt 上零输出，不摆空区块；计分制 eval 没有 `t.score` 调用时同样不渲染「给分记录」区块。

## Turn（`t.send()`）的展示

一次 `t.send()` 产生一个 Turn，它有五类展示内容：**身份**、**status**、**事件流**、**usage** 与 **`turn.data`**。
身份使用下文定义的轮标签；status 是 completed / failed / waiting。
事件流展示本轮对话与工具卡片，usage 展示 token 与成本。
Adapter 提供结构化输出时展示 `turn.data`。
语法契约在 [Show](../../reports/show.md) 与 [View](../../reports/view.md)，这里给对照示例。

**轮标签**是本节的单点定义，别处只引用。
主会话第 N 轮是 `turn<N>`，例如 `turn1`、`turn2`。
`t.newSession()` 创建的会话按创建顺序编号：主会话是 1，新会话从 2 起。
其轮标签是 `session<K>/turn<N>`，例如 `session2/turn1`；轮次在各自会话内计数。

标签使用完整单词，第一次读输出的人不需要图例。
主会话不带前缀，与「`t.send()` 是主线、`t.newSession()` 是额外会话」的 API 形态对应。
同一枚 token 原样出现在 `--execution` 轮头行、`--timing` turn 节点、`--source` send 标注、`--diff` / `diff.json` 的 `windows`，以及 [`sandbox history` / `diff`](../../sandbox/cli.md#回放留存现场的变更历史sandbox-history-diff)。
复制进 `--window` 时也使用它。
标签是不透明字符串；跨面对照按字符串等值，消费方不解析内部结构。

**show 首页 `execution:` 行**——整个 attempt 的事件计数，一行看规模：

```text
execution: 12 events · 0 skill loads · 7 tool calls · 4 AI messages
```

**`show --execution`**按轮分段。
每轮以 **turn 头行**开始，首列是轮标签，后接 status、该轮墙钟与该轮 usage。
轮内使用 USER / ASSISTANT / TOOL / SKILL / SUBAGENT 时间线卡片，工具卡片带 input 与 result。
多轮、多 session 的边界因此不用数消息猜：

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

`waiting` 轮以输入请求卡片收尾。
`action` / `prompt` / `options` 正是 `t.requireInputRequest` 能过滤的字段。
`failed` 轮在头行标 `failed`，并以错误卡片收尾。
Turn failed 不等于 Attempt errored，见 [Severity 与 Verdict](../../verdict/architecture.md)。
Adapter 提供 `turn.data` 时，该轮末尾追加有界 JSON 预览的 DATA 卡片；`outputEquals` / `outputMatches` 失败时，`received` 引用的就是它：

```text
  DATA
    { "city": "Brooklyn", "temperature": 24, "condition": "sunny" }
```

**`show --timing`**——每轮是 `eval.run` 下以轮标签命名的节点，记 send 的墙钟包络；该轮带 `traceId` 时向下挂接 agent / model / tool spans。
`--execution` 回答「这一轮做了什么」，`--timing` 回答「这一轮慢在哪」，标签同源可互相对照：

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

**view Attempt 详情**——对话区与 `--execution` 同一分轮卡片语法并挂接 trace；每个 turn 头行可折叠。
Turn 的 `coverage` 相对 Agent 默认降级时，该轮头部显示证据徽标，与 `unavailable` 断言的 reason 同源：

```text
turn2 · completed · evidence: actions partial — stream reconnected mid-turn
```

**Agent diff 的轮次归属**：`show --diff` 与 `diff.json` 的 `windows` 字段使用同一枚轮标签，标出每个文件由哪些轮次修改，见 [diff.json](../../record/architecture.md#diffjson)。
读者可以从「这轮说了什么」双向对照到「这轮改了什么」。

## 相关阅读

- [Assertions 架构 · 断言记录](../architecture.md#断言记录assertionresult) —— 字段全集的单点定义。
- [Severity 与 Verdict](../../verdict/architecture.md) —— 各状态怎么折叠成判定。
- [Show](../../reports/show.md) / [View](../../reports/view.md) —— 宿主页面布局与其它证据切面。
