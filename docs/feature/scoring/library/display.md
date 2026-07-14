# 断言与 Turn 的展示 —— show 与 view 各显示什么

每条断言评估完都是一条 `AssertionResult`（字段全集见 [Scoring 架构 · 断言记录](../architecture.md#断言记录assertionresult)）；`niceeval show` 与 `niceeval view` 渲染的是同一条记录，不各自发明字段。本页按断言家族给出「记录什么字段 → 显示成什么」的对照示例，并给出 `t.send()` 产生的 Turn 在各个证据面的展示。示例以失败态为主——通过的断言在 show 首页只进计数，在 view 里折叠成一行。

## 通用渲染规则

- **show 的 attempt 首页**按结果分节，只逐条列出需要看的：`failures:`（gate 失败，含 `--strict` 下改判的 soft）、`soft below threshold:`（soft 未达标但不影响 verdict）、`scores:`（无阈值 judge 的纯打分）、`unavailable:`（证据评不了的，带 reason）。全部通过时这些节整体省略，只留 `assertions: N passed` 计数行。
- **每条的行格式**：首行 `severity · <标题>`——有 `group` 时标题是分组路径（嵌套用 " > " 拼接），随后 `assertion: <detail>` 行给检查方式；没有分组时标题就是 `name`（即 matcher / judge 摘要），`assertion:` 行与标题重复时省略。之后按有则显示的顺序列 `expected:` / `received:` / `score`（judge 与 soft 带阈值时含 `threshold`）/ `reason:`（仅 unavailable），最后 `source: <loc>`。
- **view 的 Attempt 详情**列**全量**断言：每条一行（状态图标 + 分组路径 + name + detail + 分数），展开显示 expected / received / `evidence`（这条分数看的材料预览，默认折叠）与源码位置锚（点击跳 `--eval` 同款源码视图）；judge 额外画分数条与阈值线；`unavailable` 用独立的第三态样式（非红非绿）标 reason。
- **作用域前缀**：挂在 turn / session 上的断言，`name` 带接收者前缀（`s1/t2 · calledTool(...)`、`s2 · succeeded()`）；挂在 `t` 上的 attempt 级断言无前缀。
- 所有值都是有界预览（截断规则见 [Results · 大值截断](../../results/architecture.md#大值截断)），完整证据在 `events.json` / `diff.json` 等 artifact。

## 值断言

`t.check(t.reply, includes("Brooklyn"))`——`name` = `includes("Brooklyn")`，`expected` = 匹配条件，`received` = 被检查值预览：

```text
failures:
  gate · includes("Brooklyn")
    expected: contains "Brooklyn"
    received: "It's sunny in Manhattan today, around 24°C…"
    source: evals/weather.eval.ts:12:5
```

`equals(expected)` 给两侧值预览（`expected: 4` / `received: 1`）；`matches(schema)` 的 `received` 是第一条校验错误的路径摘要：

```text
  gate · matches(WeatherSchema)
    received: data.temperature: expected number, received string
    source: evals/weather.eval.ts:14:5
```

`similarity(...).atLeast(0.9)` 是 soft 打分，未达标进 `soft below threshold:`，显示分数与阈值：

```text
soft below threshold:
  soft · similarity("布鲁克林今天晴。")   0.71 / 0.90
    received: "今天布鲁克林多云,气温 24 度。"
```

`satisfies(predicate, label)` 与 [自定义断言](custom-assertions.md) 的 `makeAssertion` 都以 `label` / `name` 作标题，`received` 是被检查值预览——谓词本身不可展示，名字就是失败的全部解释，所以必须起有信息量的名字：

```text
  gate · 最多 5 条结果
    received: [8 items] [{"id":1,…}, …]
```

`t.check(cmd, commandSucceeded())` 的 `evidence` 是命令行本身，`received` 是退出码加 stderr 尾部：

```text
  gate · commandSucceeded()
    evidence: pnpm test
    received: exit 1 · "… 2 failed, 14 passed"
```

## 作用域断言

`calledTool` 失败时 `expected` 是匹配条件、`received` 是作用域内实际调用的有界清单——回答「那它到底调了什么」：

```text
  gate · s1/t1 · calledTool("get_weather", { input: { city: "Brooklyn" } })
    expected: ≥1 call matching input.city = "Brooklyn"
    received: 2 tool calls: get_weather({"city":"SF"}) · get_time({})
```

**负断言失败要给反例定位**：`notCalledTool` / `notEvent` 的 `received` 指出命中的那一次（第几轮、事件序号、入参预览），view 里点击直接跳到事件流对应卡片：

```text
  gate · notCalledTool("bash", { input: { command: /npm i/ } })
    received: matched at s1/t2 · action#5 · bash({"command":"npm install lodash"})
```

`toolOrder` / `eventOrder` 的 `received` 是实际顺序摘要，标出首个违反点：

```text
  gate · toolOrder(["read_file", "write_file"])
    received: write_file → read_file (write_file appeared before any read_file)
```

上限断言显示上限与实测合计；`maxTokens` / `maxCost` 依赖 usage 通道：

```text
  gate · maxCost(0.5)
    expected: ≤ $0.50
    received: $0.83 (3 turns)
```

`succeeded()` / `parked()` 的 `received` 是作用域末态摘要（`turn status: failed` / `1 unanswered input request`）；`messageIncludes(token)` 与 `includes` 同款，`received` 是 assistant 文本预览；`eventsSatisfy(label, predicate)` 以 `label` 为标题，`received` 固定为事件流规模摘要（`38 events in scope`）——谓词不透明，解释责任在 label。

## Judge

无阈值 judge 是纯打分，进 `scores:` 节；`evidence` 是裁判实际收到的材料预览（view 里默认折叠展开看）：

```text
scores:
  soft · closedQA("修改是否聚焦问题?")   0.82
```

`.atLeast(x)` 未达标进 `soft below threshold:`（同上格式，`0.58 / 0.70`）；`.gate(x)` 失败进 `failures:`：

```text
failures:
  gate · closedQA("diff 是否只修改目标逻辑?")   0.40 / 0.70
    evidence: (on: t.sandbox.diff.get("src/weather.ts")) "@@ -12,6 +12,9 @@ …"
    source: evals/refactor.eval.ts:21:3
```

judge 没有解析到模型 / key 时记 `unavailable`（[判定规则](../architecture/severity-and-verdict.md#证据不可用unavailable不折叠成通过)：非 `.optional()` 的断言评不了 → attempt `errored`）：

```text
unavailable:
  gate · closedQA("修改是否聚焦问题?")
    reason: judge-model-unresolved (no model in config, NICEEVAL_JUDGE_MODEL unset)
```

## Sandbox 断言

`fileChanged` / `fileDeleted` / `notInDiff` 断的是 [agent 归因增量](../../sandbox/architecture.md#变更归因send-窗口与分类账)，失败信息要能区分「agent 没改」与「文件只被 eval 侧写入」：

```text
  gate · fileChanged("src/legacy.js")
    expected: changed by agent in some send window
    received: not changed in any of 2 send windows (file exists; written outside send windows)
```

`notInDiff(re)` 失败给命中文件与行预览；`noFailedShellCommands()` 失败给失败命令与退出码——都与 view 的 diff / 事件视图同源，view 里可点进对应文件 diff：

```text
  gate · notInDiff(/console\.log/)
    received: matched in src/app.ts:47 "console.log(debugPayload)"
```

## 证据缺口的 unavailable

负断言与上限断言在所需证据通道非 complete（含 unknown）时进 `unavailable:` 并给通道原因；正断言在非 complete 通道上没找到匹配同样是 `unavailable`，不是 failed（[EvidenceCoverage](../../adapters/architecture/evidence.md#覆盖声明evidencecoverage)）。view 在 Attempt 详情顶部同时显示 coverage 徽标；带 `.optional()` 的条目额外标 `optional`，说明它不影响判定：

```text
unavailable:
  gate · notCalledTool("bash")
    reason: coverage:actions=partial (adapter only captures successful actions)
  soft · optional · closedQA("文风是否友好?")
    reason: judge-model-unresolved
```

## 分组

`t.group` 嵌套体现在标题的分组路径上，view 里同组断言折叠在同一个分组块下：

```text
failures:
  gate · 天气查询 > 城市解析
    assertion: equals("Brooklyn")
    expected: "Brooklyn"
    received: "Manhattan"
    source: evals/weather.eval.ts:31:7
```

## Turn（`t.send()`）的展示

一次 `t.send()` 产生一个 Turn，它自己有五样要展示的东西：**身份**（`s<session>/t<turn>`，全部证据面共用这套标签）、**status**（completed / failed / waiting）、**事件流**（这一轮的对话与工具卡片）、**usage**（这一轮的 token / 成本）、**`turn.data`**（结构化输出，如果 Adapter 给了）。语法契约在 [Show](../../reports/show.md) 与 [View](../../reports/view.md)，这里给对照示例。

**show 首页 `execution:` 行**——整个 attempt 的事件计数，一行看规模：

```text
execution: 12 events · 0 skill loads · 7 tool calls · 4 AI messages
```

**`show --execution`**——按轮分段：每轮以 **turn 头行**开始（身份 · status · 该轮墙钟 · 该轮 usage），轮内是时间线卡片（USER / ASSISTANT / TOOL / SKILL / SUBAGENT），工具卡片带 input 与 result。多轮、多 session 的边界因此不用数消息猜：

```text
TURN s1/t1 · completed · 22.4s · 12.4k tok · $0.02
  USER
    把部署脚本改成蓝绿发布。

  ASSISTANT
    I'll update the deploy script and ask for confirmation before applying.

  TOOL · shell  +8.2s · 1.1s
    input
      /bin/bash -lc 'cat deploy.sh'
    result · completed · exit 0
      #!/usr/bin/env bash …

TURN s1/t2 · waiting · 3.1s · 1.8k tok
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

**`show --timing`**——每轮是 `eval.run` 下的一个 `turn s<session>/t<turn>` 节点，记 send 的墙钟包络；该轮带 `traceId` 时向下挂接 agent / model / tool spans。`--execution` 回答「这一轮做了什么」，`--timing` 回答「这一轮慢在哪」，标签同源可互相对照：

```text
eval.run              26.3s
  ├─ turn s1/t1           22.4s
  │    ├─ agent · codex run             21.9s
  │    │    ├─ model · gpt-5.4 call #1   6.3s
  │    │    └─ tool · shell              1.1s
  └─ turn s1/t2            3.1s
```

**view Attempt 详情**——对话区与 `--execution` 同一分轮卡片语法并挂接 trace；每个 turn 头行可折叠。Turn 的 `coverage` 相对 Agent 默认降级时，该轮头部显示证据徽标，与 `unavailable` 断言的 reason 同源：

```text
TURN s1/t2 · completed · evidence: actions partial — stream reconnected mid-turn
```

**agent diff 的轮次归属**——`show --diff` 与 `diff.json` 的 `windows` 字段用同一套 `s1/t1` 标签标出每个文件是哪几轮改的（见 [diff.json](../../results/architecture.md#diffjson)），从「这轮说了什么」到「这轮改了什么」双向可对。

## 相关阅读

- [Scoring 架构 · 断言记录](../architecture.md#断言记录assertionresult) —— 字段全集的单点定义。
- [Severity 与 Verdict](../architecture/severity-and-verdict.md) —— 各状态怎么折叠成判定。
- [Show](../../reports/show.md) / [View](../../reports/view.md) —— 宿主页面布局与其它证据切面。
