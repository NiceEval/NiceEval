# Eval —— Library 用例

本目录是编写 eval 的 Library API 用例文档（体裁约定见[功能文档](../../README.md)）：一篇讲一个真实用例的全流程——作者要评什么、从驱动到断言的完整写法、边界与何时改用别的模式。
契约单源在 [Library](../library.md)、[Context](../library/context.md)、[Assertions](../../assertions/library.md) 与 [Sandbox](../../sandbox/library.md)，这里只做叙事串联，不复制契约定义。

从上往下读是一条学习路径：前两篇覆盖所有 eval 都会用的驱动与断言，后面各篇按需进入。

## 会话驱动

- [单轮：一问一答就断言](first-single-turn.md)
- [多轮与并行会话：每轮各自断，整段一起评](multi-turn-sessions.md)
- [HITL 审批：agent 停在人工输入上](hitl-approval.md)

## 评分

- [过程与成本：断 agent 怎么做到的](process-and-cost.md)
- [calledTool 匹配全参数：每个字段每种形态怎么用](calledtool.md)
- [裁判评质量：规则写不出对错时](judge-quality.md)
- [计分制：五步走完三步挣 3 分](rubric-scoring.md)

## 规模与环境

- [测试集从输入数组生成多条 eval：一套逻辑跑一批 case](dataset-fanout.md)
- [本地测试文件：普通上传与动态身份](criteria-files.md)
- [沙箱 coding 任务：从放文件到评 diff](sandbox-coding.md)
- [Fixture 与反馈：prepare 与长步骤报告](fixtures-lifecycle.md)

## 通过制还是计分制

一条 eval 怎么计分由定义函数声明：**`defineEval` = 通过制**，整题折叠成一分；**`defineScoreEval` = 计分制**，题内叠加挣分、不声明满分。
同一 experiment 可以混合两种题型，报告分别计算通过率与总分——契约见[计分粒度](../../assertions/library/score-points.md)。
各用例的计分形态：

| 用例 | 计分形态 |
|---|---|
| [单轮](first-single-turn.md) · [HITL 审批](hitl-approval.md) | **通过制**：几条 gate 折叠成一个 verdict |
| [多轮与并行会话](multi-turn-sessions.md) | 通过制；要对比「挂在第几轮」时按轮 `t.group`，gate 失败按组定位 |
| [过程与成本](process-and-cost.md) | 通过制为主：gate 定判定，`.atLeast(1)` / `.soft()` 记质量分 |
| [计分制](rubric-scoring.md) | **计分制的典型场景**：检查点 `.points(1)` 各挣各的、`t.require()` 前置中止、rubric 按分值给分 |
| [沙箱 coding 任务](sandbox-coding.md) | 两制都常见：整题过/不过用 `defineEval`；要部分分时改用 `defineScoreEval` 按步骤给分 |
| [裁判评质量](judge-quality.md) | judge 默认 `.soft()` 进质量分；计分制里 `.points(n)` 按连续分比例挣 |
| [测试集从输入数组生成多条 eval](dataset-fanout.md) | **通过制 × N**：独立可跑的 case 拆成多个 eval——粒度来自更多的题，不是更细的分 |
| [Fixture 与反馈](fixtures-lifecycle.md) | 与计分正交 |

选择规则一句话：**独立可跑的题目拆 eval；「做对」二值的题用通过制；「做到几成」有意义的题用计分制给分**。

## API → 篇目对照

| API | 所在篇目 |
|---|---|
| `t.send` / `t.sendFile` / `t.reply` / `turn.message` / `turn.data` | [单轮](first-single-turn.md) |
| `turn.succeeded` / `turn.judge` / `t.newSession()` / `session.*` | [多轮与并行会话](multi-turn-sessions.md) |
| `parked` / `requireInputRequest` / `respond` / `respondAll` | [HITL 审批](hitl-approval.md) |
| `calledTool` / `notCalledTool` / `toolOrder` / `usedNoTools` / `loadedSkill` / `calledSubagent` | [过程与成本](process-and-cost.md) · [calledTool 全参数](calledtool.md) |
| `event` / `notEvent` / `eventOrder` / `eventsSatisfy` | [过程与成本](process-and-cost.md) |
| `maxToolCalls` / `maxTokens` / `maxCost` / `noFailedActions` | [过程与成本](process-and-cost.md) |
| `t.group` / `.gate()` / `.atLeast(x)` / `.soft()` / `.optional()` | [过程与成本](process-and-cost.md) |
| `t.check` / `t.require` / `niceeval/expect` matcher | [单轮](first-single-turn.md) · [沙箱](sandbox-coding.md) |
| `t.judge` / `session.judge` / `turn.judge` / `autoevals.*` / `{ on }` / `.atLeast(x)` | [裁判评质量](judge-quality.md) |
| `.points(n)` / `t.score` / `t.require()` / `.stopOnFailure()` | [计分制](rubric-scoring.md) |
| 数组导出 / keyed record 导出 / `loadYaml` / `loadJson` | [测试集从输入数组生成多条 eval](dataset-fanout.md) |
| `loadText` | [本地测试文件](criteria-files.md) |
| `t.sandbox.writeFiles` / `uploadDirectory` / `downloadDirectory` / `runCommand` / `runShell` | [沙箱 coding 任务](sandbox-coding.md) |
| `t.sandbox.diff` / `file` / `fileChanged` / `fileDeleted` / `notInDiff` | [沙箱 coding 任务](sandbox-coding.md) |
| `sandbox` + `.prepare()` / `t.progress` / `t.diagnostic` / `t.skip` | [Fixture 与反馈](fixtures-lifecycle.md) |
