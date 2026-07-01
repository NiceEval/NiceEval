# Assertions —— 断言参考(作用域 + 来源)

这一篇是断言的速查参考:每条 API 做什么、看哪一轮、属于哪一类。怎么把它们组织进 eval,见 [Eval Authoring](eval-authoring.md);判决规则与 judge 细节见 [Scoring](scoring.md)。

> **来源一句话:** 会话 / 作用域断言 DX 借自 **eve.dev evals**;sandbox / diff 的工程形状借自 **Vercel agent-eval**;`--budget` 等护栏借鉴 **crabbox**;`closedQA` / `factuality` / `summarizes` 直接用 **autoevals(Braintrust)**。

断言是 eval 给 `test(t)` 的产出打分的方式。每条记录一个结果、返回可链式 handle;runner 收齐**所有**记录再算判决,所以一次运行会报告每一条失败断言,而不是遇到第一个就停。

## Attempt 和 Turn

`Attempt` 和 `Turn` 不是同一个东西。

| 概念 | 含义 | 断言作用域 |
|---|---|---|
| **Attempt** | 一个 eval 在一个 agent / model / run index 下的一次完整执行 | `t.succeeded()` / `t.calledTool()` 等看这个 attempt 的全部轮次和全部 `newSession()` |
| **Turn** | 一次 `t.send()` 返回的一轮交互结果 | `turn.succeeded()` / `turn.calledTool()` 等只看这一轮自己的事件 |

它们共享一套断言词汇,但绑定的数据不同。规则是:**作用域由你调用在哪个对象上决定,不由断言名字决定。**

## API 分组速查

### 对话与轮次

| API | 作用 | 备注 |
|---|---|---|
| `await t.send(text)` | 给 agent 发一轮输入 | 返回 `turn`,用于单轮断言 |
| `await t.sendFile(path, text?)` | 给 agent 发带文件的一轮输入 | 文件从宿主项目读取 |
| `t.reply` | 最后一条 assistant 消息 | 值级 judge / matcher 的默认材料 |
| `t.newSession()` | 开一条独立会话线 | `t.*` attempt 级断言会聚合全部 session |
| `turn.message` | 这一轮 assistant 消息 | 多轮 judge 时建议自己收集这些值 |
| `turn.data` | 这一轮结构化输出 | 配 `turn.outputEquals` / `turn.outputMatches` |
| `turn.status` | 这一轮状态 | `completed` / `failed` / `waiting` |
| `turn.events` | 这一轮标准事件流 | 只含这一轮,不含之前轮次 |
| `turn.usage` | 这一轮 token 用量 | 可选,取决于 adapter 能否带回 |

### Attempt 级作用域断言

| API | 作用 | 来源 |
|---|---|---|
| `t.succeeded()` | 运行没失败、且没卡在未回答的 HITL | eve.dev |
| `t.parked()` | 干净停在 HITL 输入上 | eve.dev |
| `t.messageIncludes(token)` | attempt 全程 assistant 文本拼接后含 token | eve.dev |
| `t.calledTool(name, match?)` | 有匹配 name / input / status 的工具调用 | eve.dev |
| `t.notCalledTool(name, match?)` | 没有匹配的工具调用 | eve.dev |
| `t.toolOrder(names)` | 工具调用按给定子序出现 | eve.dev |
| `t.usedNoTools()` | 完全没调工具 | eve.dev |
| `t.maxToolCalls(max)` | 工具调用数不超过 max | eve.dev |
| `t.loadedSkill(skill)` | `calledTool("load_skill", { input: { skill } })` 的糖 | eve.dev |
| `t.calledSubagent(name, match?)` | 子 agent 委派匹配 | eve.dev |
| `t.noFailedActions()` | 没有 failed 的工具 / 子 agent 动作 | eve.dev |
| `t.event(type, opts?)` | 出现某类型事件,可指定 count | eve.dev |
| `t.notEvent(type)` | 没出现某类型事件 | eve.dev |
| `t.eventOrder(types)` | 事件类型按给定子序出现 | eve.dev |
| `t.eventsSatisfy(label, predicate)` | 自定义谓词直接查事件流 | eve.dev |
| `t.maxTokens(max)` | input + output token 不超过 max | fasteval |
| `t.maxCost(usd)` | 估算成本不超过 usd | fasteval |

### Turn 级作用域断言

| API | 作用 | 备注 |
|---|---|---|
| `turn.succeeded()` | 这一轮没失败、且没卡在 HITL | 与 `t.succeeded` 同名,作用域收窄 |
| `turn.parked()` | 这一轮干净停在 HITL 输入上 | 与 `t.parked` 同名 |
| `turn.messageIncludes(token)` | 这一轮 assistant 文本含 token | 不看其它轮 |
| `turn.calledTool(name, match?)` | 这一轮有匹配工具调用 | 不看其它轮 |
| `turn.notCalledTool(name, match?)` | 这一轮没有匹配工具调用 | 不看其它轮 |
| `turn.toolOrder(names)` | 这一轮工具调用按给定子序出现 | 不看其它轮 |
| `turn.usedNoTools()` | 这一轮完全没调工具 | 不看其它轮 |
| `turn.maxToolCalls(max)` | 这一轮工具调用数不超过 max | 不看其它轮 |
| `turn.loadedSkill(skill)` | 这一轮加载了指定 skill | 不看其它轮 |
| `turn.calledSubagent(name, match?)` | 这一轮有匹配子 agent 委派 | 不看其它轮 |
| `turn.noFailedActions()` | 这一轮没有 failed 动作 | 不看其它轮 |
| `turn.event(type, opts?)` | 这一轮出现某类型事件 | 不看其它轮 |
| `turn.notEvent(type)` | 这一轮没出现某类型事件 | 不看其它轮 |
| `turn.eventOrder(types)` | 这一轮事件类型按给定子序出现 | 不看其它轮 |
| `turn.eventsSatisfy(label, predicate)` | 自定义谓词查这一轮事件 | 不看其它轮 |
| `turn.expectOk()` | 这一轮 failed 时抛错中止后续 | turn 独有 |
| `turn.outputEquals(value)` | `turn.data` 深度相等 | turn 独有 |
| `turn.outputMatches(schema)` | `turn.data` 通过 schema | turn 独有 |

### 值级断言

| API | 作用 | 备注 |
|---|---|---|
| `t.check(value, matcher)` | 记录一条值级断言 | 可延迟读取 `t.sandbox.file()` |
| `t.require(value, matcher)` | 立即评估前置条件 | 不过就抛,中止后续 |
| `includes(needle, opts?)` | 含子串 / 命中正则 | 默认 gate |
| `excludes(needle, opts?)` | 不含子串 / 不命中正则 | 默认 gate |
| `equals(expected)` | 深度相等 | 默认 gate |
| `matches(schema)` | Standard Schema / zod 校验 | 默认 gate |
| `similarity(expected)` | 归一化相似度 `[0,1]` | 默认 soft |
| `satisfies(predicate, label?)` | 自定义谓词 | 默认 gate |
| `isDefined(label?)` | `value != null` | 默认 gate |
| `isTrue(label?)` | 严格等于 `true` | 默认 gate |
| `isFalse(label?)` | 严格等于 `false` | 默认 gate |
| `commandSucceeded()` | 命令退出码为 0 | 用来替代 `scriptPassed` |
| `makeAssertion(spec)` | 自定义 matcher | 复杂评分逃生舱 |

### Sandbox:文件 IO

| API | 作用 | 备注 |
|---|---|---|
| `t.sandbox.writeFiles(files)` | 写入文本文件清单 | 立即写入 sandbox |
| `t.sandbox.uploadFiles(files)` | 写入文本 / 二进制文件清单 | 立即写入 sandbox |
| `t.sandbox.readFile(path)` | 读取 sandbox 文件 | 立即读取 |
| `t.sandbox.fileExists(path)` | 判断 sandbox 文件是否存在 | 立即读取 |
| `t.sandbox.readSourceFiles(root?)` | 批量读取源码文件 | 立即读取 |

### Sandbox:命令执行

| API | 作用 | 备注 |
|---|---|---|
| `t.sandbox.runCommand(cmd, args?, opts?)` | 执行命令并返回结果 | 不自动评分 |
| `t.sandbox.runShell(script, opts?)` | 执行 shell 脚本并返回结果 | 不自动评分 |
| `t.sandbox.getWorkingDirectory()` | 读取当前工作目录 | author-facing sandbox 句柄 |
| `t.sandbox.setWorkingDirectory(path)` | 设置当前工作目录 | author-facing sandbox 句柄 |

`Sandbox.stop()` 是运行器生命周期职责,不暴露给 eval 作者。eval 只描述“测什么、怎么判分”,不负责销毁沙箱。

### Sandbox:结果断言与 diff

| API | 作用 | 备注 |
|---|---|---|
| `t.sandbox.fileChanged(path)` | 文件出现在生成 diff 里 | 延迟断言 |
| `t.sandbox.fileDeleted(path)` | 文件被删除 | 延迟断言 |
| `t.sandbox.notInDiff(re)` | diff 不含某模式 | 延迟断言 |
| `t.sandbox.diff.get(path)` | 读取某文件 diff 内容 | 值级断言材料 |
| `t.sandbox.diff.isEmpty()` | diff 是否为空 | 值级断言材料 |
| `t.sandbox.diff.matches(re)` | diff 是否命中正则 | 值级断言材料 |
| `t.sandbox.file(path)` | 延迟读取 sandbox 文件 | 配 `t.check` 使用 |

同一个 `t.sandbox` 下同时有“放文件”和“断言文件变化”,但文档按类别区分:

- 文件 IO 和命令执行是**立即动作**;
- diff / fileChanged / file 是**结果视图和延迟断言**;
- 沙箱创建、清理、停止是**runner 生命周期**,不暴露给 eval 作者。

### Judge

| API | 作用 | 备注 |
|---|---|---|
| `t.judge.autoevals.closedQA(criteria, opts?)` | 闭合式判断 | autoevals |
| `t.judge.autoevals.factuality(expected, opts?)` | 事实一致性 | autoevals |
| `t.judge.autoevals.summarizes(source, opts?)` | 是否忠实摘要 | autoevals |

judge 默认材料是 `t.reply`。评多轮对话时,自己收集每轮 `turn.message` 再传 `{ on }`;评 sandbox 产物时,显式传 `t.sandbox.diff.get(path)` 或 `await t.sandbox.readFile(path)`。

## 作用域规则

作用域由你调用在哪个对象上决定,不由断言名字决定。

| 层 | 谁 | 作用域 |
|---|---|---|
| **值级** | `t.check(value, matcher)`、judge 的 `{ on }` | 只评你传进去的值;默认值通常是 `t.reply` |
| **attempt 级** | `t.succeeded()`、`t.calledTool()`、`t.event()` 等 | `test` 跑完后,看这个 attempt 的全部轮次和全部 `newSession()` |
| **turn 级** | `turn.succeeded()`、`turn.calledTool()`、`turn.event()` 等 | 只看这一轮自己的事件 |
| **sandbox 结果级** | `t.sandbox.fileChanged()`、`t.sandbox.diff` 等 | 只看这个 attempt 最终 sandbox diff,不按轮次切分 |

值级 judge / matcher 默认看最后一轮,和 `t.*` 默认看全程不是一套规则。要评整段多轮对话,显式收集材料:

```typescript
const turns = [
  await t.send("这张图里有什么?"),
  await t.send("背景是什么颜色?"),
  await t.send("中间那个形状是什么颜色的?"),
];

const conversation = turns.map((turn) => turn.message).join("\n");
t.judge.autoevals.closedQA("助手是否始终基于第一轮的图片作答?", { on: conversation }).atLeast(0.7);
```

## 命令结果怎么评分

命令执行和评分分开。`runCommand` / `runShell` 只负责执行并返回结果;是否通过,用普通 matcher 表达。

```typescript
import { commandSucceeded, excludes } from "fasteval/expect";

const test = await t.sandbox.runCommand("npm", ["test"]);

t.check(test, commandSucceeded());
t.check(test.stderr, excludes("TypeError"));
```

不保留 `scriptPassed()` / `testsPassed()` 作为目标 DX。它们来自 Vercel agent-eval 的固定 fixture 流程:`PROMPT.md` + `EVAL.ts` + `scripts[]` 由 runner 自动调度。fasteval 的目标形状是“用户在 `test(t)` 里手工写入文件、手工运行验证命令、手工断言命令结果”,所以不再需要一个同时暗示“执行脚本”和“注册断言”的 API。

## 沙箱能力错误

eval 不需要额外声明 `requires`。如果在不支持 sandbox 的 agent 上调用 `t.sandbox`,运行时直接抛出清晰错误:

```text
This eval used t.sandbox.fileChanged(), but agent "web-agent" does not provide a sandbox.
Use a sandbox agent, or remove sandbox calls from this eval.
```

这样 `defineEval` 保持轻;错误出现在实际用错的 API 上,比额外维护一份 capability 声明更直接。

## 严重级:gate vs soft

- **gate** —— 硬要求,不过即 `failed`,任何时候都生效。`includes` / `equals` 等默认 gate。
- **soft** —— 质量分,非 `--strict` 下不让 eval failed;`--strict` 下低于阈值才 failed。`similarity` 和 judge 默认 soft。

链式改写:

| API | 作用 |
|---|---|
| `.atLeast(x)` | soft 阈值;非 `--strict` 只记分,`--strict` 下低于 x 才 failed |
| `.gate()` | 转成硬要求;低于默认通过线即 failed |
| `.gate(x)` | 转成硬阈值;低于 x 任何时候都 failed |

示例:

```typescript
t.check(t.reply, includes("晴"));                         // 默认 gate
t.check(t.reply, similarity(expected).atLeast(0.8));      // soft 阈值
t.check(t.reply, similarity(expected).gate(0.8));         // 硬阈值
t.judge.autoevals.closedQA("语气是否礼貌");                // soft 纯记分
t.judge.autoevals.closedQA("语气是否礼貌").atLeast(0.7);   // soft 阈值
```

## 来源一览 & 哪些是 fasteval 自创

| 来源 | 给了 fasteval 什么 | 出处 |
|---|---|---|
| **eve.dev evals** | 声明式 DX、路径即身份、gate/soft 分层、scoped / value / turn 断言形态、`t.check` / `t.require`、匹配器、LLM-judge 接口 | `docs/architecture.md`、`docs/README.md` |
| **Vercel agent-eval** | Adapter / Sandbox 工程形状、sandbox diff、transcript 归一化与可观测、experiment 层、本地 `fasteval view` | `docs/vision.md`、`docs/experiments.md` |
| **crabbox** | capability 分发纪律、`--budget` / `maxCost` 的 spend cap、source-map 文档观 | `docs/vision.md`、`docs/runner.md` |
| **autoevals(Braintrust)** | `closedQA` / `factuality` / `summarizes` 评判器 | `src/scoring/judge.ts` |

**fasteval 自创(不在以上任何来源里):**

- **成本聚合** —— 用量 → 成本价格表估算 + `t.maxCost()`。
- **匹配器扩展** —— `excludes` / `isDefined` / `isTrue` / `isFalse` / `commandSucceeded`。
- **sandbox author API 分层** —— 文件 IO / 命令执行 / 结果断言都在 `t.sandbox`,但生命周期动作如 `stop()` 不暴露给 eval 作者。
- **本地结果查看器** —— 读 `.fasteval/<run>/` 结构化工件出图。

## 接下来读什么

- [Eval Authoring](eval-authoring.md) —— 怎么把这些 API 组织进单轮 / 多轮 / 数据集 / 沙箱型 eval。
- [Scoring](scoring.md) —— 判决规则、judge 细节、效率 / 成本断言。
- [Agents 与 Adapters](agents-and-adapters.md) —— 断言读的标准事件流从哪来。
- [Observability](observability.md) —— transcript / usage / cost 的数据来源。
