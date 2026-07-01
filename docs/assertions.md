# Assertions —— 断言参考(作用域 + 来源)

这一篇是断言的速查参考:每条**做什么**、**看哪一轮**、**来源哪里**(以及哪些是 fasteval 自创)。怎么把它们组织进一个 eval,见 [Eval Authoring](eval-authoring.md);判决规则与 judge 细节见 [Scoring](scoring.md)。

> **来源一句话:** 整套断言 DX(声明式、路径即身份、gate/soft 分层、LLM-as-judge)借自 **eve.dev evals**;沙箱 / diff 这类借自 **Vercel agent-eval**;`--budget` 等护栏借鉴 **crabbox**;`closedQA`/`factuality`/`summarizes` 直接用 **autoevals(Braintrust)**。逐条见下方各表的「来源」列与文末[来源一览](#来源一览--哪些是-fasteval-自创)。

断言是 eval 给 `test(t)` 的产出打分的方式。每条记录一个结果、返回可链式的 handle;runner 收齐**所有**记录再算判决,所以一次运行会报告**每一条**失败断言,而不是遇到第一个就停。

## 作用域:两层,同一套词汇

多轮里最容易错的是「这条到底看哪一轮?」。规则很简单:**作用域由你调用在哪个对象上决定,不由断言叫什么名字决定**——`t.X` 和 `turn.X` 是同一套名字,分别绑在两个位置。

| 层 | 谁 | 作用域 |
|---|---|---|
| **值级** | `t.check(value, …)`、judge 的 `{ on }` | 评你传进去的值;**默认值 = `t.reply` = 最后一轮** assistant 消息。`t.judge.autoevals.*` 一律默认 `on: t.reply`;要评工作区产物(diff),显式传 `{ on: t.sandbox.diff.get(path) }`——没有单独的方法自动切换材料;judge 默认 soft |
| **`t.*`(attempt 级)** | `t.succeeded` / `t.messageIncludes` / `t.calledTool` / `t.event` … | `test` 跑完后对**这次 attempt 全程**评估:含全部轮次,以及 `t.newSession()` 开的额外会话。对齐 eve 的 `assertions/scoped.ts`(`createScopedAssertions` 绑 `timing: "final"`,读 `sessions.flatMap(session => session.events)`);详见 [Eval Authoring · 补充](eval-authoring.md#补充作用域只有两层一套词汇对齐-eve) |
| **`turn.*`(轮级)** | `t.send()` 返回的 turn 上:`turn.succeeded` / `turn.messageIncludes` / `turn.calledTool` / `turn.event` … ,加 turn 独有的 `turn.expectOk` / `turn.outputEquals` / `turn.outputMatches` | 只看**这一轮自己的事件**,不含之前轮次。跟 `t.*` 是**同一套断言名字**,只是绑的数据范围从"全程"换成"这一轮"——对齐 eve 的 turn handle(`timing: "snapshot"`) |

值级(judge / `t.check`)默认只看最后一轮,和 `t.*` 默认看全程,是两条独立的规则,不矛盾。要评整段多轮对话(judge 跨轮一致性),自己把每轮的 `turn.message` 收集拼起来再传给 judge,写法见 [Eval Authoring · 多轮里评整段对话](eval-authoring.md#多轮里评整段对话);要断言"这一轮"有没有调某个工具、有没有成功,直接调 `turn.calledTool(...)` / `turn.succeeded()`,不必退回全程聚合。

`t.sandbox.*` 工作区断言(`fileChanged`/`diff`/…)不参与这套 t/turn 二元性——它们只在 attempt 级出现,没有 turn 级镜像,因为沙箱的 git diff 是整个 attempt 一份,不按轮次切分。详见[工作区断言](#工作区断言tsandbox仅-workspace-能力)。

## 作用域断言(`t` 上,attempt 全程评估)

读自[标准事件流](agents-and-adapters.md)与其派生事实——只要 adapter 产出标准 `events`,对任何 agent 都成立。全部默认 **gate**。作用域是这次 eval 执行的**整个 attempt**:全部轮次,加上 `t.newSession()` 开的额外会话;对齐 eve 的 `assertions/scoped.ts`(见 [Eval Authoring · 补充](eval-authoring.md#补充作用域只有两层一套词汇对齐-eve))。同一套名字在 `t.send()` 返回的 turn 上重复出现,作用域收窄成"这一轮",见下方[轮级断言](#轮级断言tsend-返回的-turn-上)。

| 断言 | 作用 | 来源 |
|---|---|---|
| `t.succeeded()` | 运行没失败、且没卡在未回答的 HITL | eve.dev |
| `t.parked()` | 干净停在 HITL 输入上 | eve.dev |
| `t.messageIncludes(token)` | attempt 全程的 assistant 文本拼接后含 token(串 / 正则) | eve.dev |
| `t.calledTool(name, match?)` | 有匹配 name + input + status 的工具调用(可精确计数) | eve.dev |
| `t.notCalledTool(name, match?)` | 没有匹配的工具调用 | eve.dev |
| `t.toolOrder([...names])` | 工具调用按给定子序出现 | eve.dev |
| `t.usedNoTools()` | 完全没调工具 | eve.dev |
| `t.maxToolCalls(n)` | 工具调用数 ≤ n | eve.dev |
| `t.loadedSkill(skill)` | = `calledTool("load_skill", { input: { skill } })` 的糖 | eve.dev |
| `t.calledSubagent(name, match?)` | 子 agent 委派匹配(同 `ToolMatch` 小语言) | eve.dev(`assertions/scoped.ts`) |
| `t.noFailedActions()` | 没有 failed 的工具 / 子 agent 动作 | eve.dev |
| `t.event(type, { count? })` | 出现(或恰好 count 个)某类型事件 | eve.dev |
| `t.notEvent(type)` | 没出现某类型事件 | eve.dev |
| `t.eventOrder([...types])` | 事件分组按给定顺序出现 | eve.dev(`assertions/scoped.ts`) |
| `t.eventsSatisfy(label, predicate)` | 自定义谓词直接查 `events` | eve.dev(`assertions/scoped.ts`) |
| `t.maxTokens(n)` | 整次 input + output token ≤ n | fasteval(用量聚合,补 agent-eval 的 TODO) |
| `t.maxCost(usd)` | 估算成本 ≤ usd(需价格表) | **fasteval 自创**(预算护栏思路借鉴 crabbox) |

## 工作区断言(`t.sandbox.*`,仅 workspace 能力)

凡是检查「沙箱文件系统」状态的断言——文件变化、diff、测试通过——都挂在 **`t.sandbox` 下**,跟沙箱的原始句柄(`runCommand`/`writeFiles`/…)住在同一个命名空间,因为它们都是"读/改沙箱这个东西"。评工作区产物(diff)没有单独的方法:直接用 `t.judge.autoevals.closedQA(criteria, { on: t.sandbox.diff.get(path) })`,显式传材料。

| `t.sandbox.*` | 作用 |
|---|---|
| `fileChanged(path)` | 该文件出现在生成 diff 里 |
| `fileDeleted(path)` | 该文件被删 |
| `notInDiff(re)` | 改动里不含某模式(密钥、内联 style…) |
| `scriptPassed(script)` | 指定 npm 脚本退出 0(手工跑测试后用它断言,见下) |
| `noFailedShellCommands()` | 没有 failed 的 shell 工具调用 |

非断言的访问器:`t.sandbox.diff`(`.get(path)` / `.isEmpty()` / `.matches(re)`)、`t.sandbox.file(path)`(延迟文件引用)。`t.sandbox` 同时也是沙箱的**原始句柄**——`runCommand` / `runShell` / `readFile` / `fileExists` / `readSourceFiles` / `writeFiles` / `uploadFiles` / `getWorkingDirectory` / `setWorkingDirectory` / `stop`——用来在 `test()` 里手工 seed 文件或跑命令。没有另一条"静态 seed"路径:所有起始文件都靠显式调用 `t.sandbox.writeFiles` / `uploadFiles` 放进去,放到哪个路径由你的代码决定。用法见 [Eval Authoring · 沙箱型](eval-authoring.md#沙箱型手工把文件放进沙箱)。

**来源**:这些断言本身来自 **Vercel agent-eval**,组织上归进 `t.sandbox` 命名空间,和沙箱的原始句柄放在一起。

## 轮级断言(`t.send()` 返回的 turn 上)

跟上面[作用域断言](#作用域断言t-上attempt-全程评估)是**同一套名字、同一套语义**,只是绑的数据换成"这一轮自己的事件",不含之前轮次:`turn.succeeded` / `turn.parked` / `turn.messageIncludes` / `turn.calledTool` / `turn.notCalledTool` / `turn.toolOrder` / `turn.usedNoTools` / `turn.maxToolCalls` / `turn.loadedSkill` / `turn.calledSubagent` / `turn.noFailedActions` / `turn.event` / `turn.notEvent` / `turn.eventOrder` / `turn.eventsSatisfy`。来源 **eve.dev**(`assertions/scoped.ts` 绑到 turn handle 的 `timing: "snapshot"`)。

turn 独有、不在 attempt 级出现的几个(只对单轮有意义):

| 断言 | 作用 |
|---|---|
| `turn.expectOk()` | 本轮 failed 就抛(带最后一条 error 诊断),否则可链 |
| `turn.outputEquals(value)` | `turn.data` 深度相等 |
| `turn.outputMatches(schema)` | `turn.data` 过 Standard Schema / zod 校验 |

(`turn.message` / `turn.data` / `turn.usage` / `turn.status` / `turn.events` 是只读字段,不是断言。)

## 值级断言:`t.check` / `t.require` + 匹配器

- `t.check(value, matcher)` —— 记录一条**延迟**断言(`t.sandbox.file()` 的 `FileRef` 到 finalize 才读)。
- `t.require(value, matcher)` —— **立即**评估、记成 gate,不过就抛 `EvalRequirementFailed` 中止后续(前置条件)。

来源 **eve.dev**。匹配器从 `fasteval/expect` 导入,都返回可链式 `.gate()` / `.atLeast(x)` 的 `ValueAssertion`(只有这两个链式方法,`.atLeast(x)` 本身就是 soft):

| 匹配器 | 打分 | 默认严重级 | 来源 |
|---|---|---|---|
| `includes(needle, opts?)` | 含子串 / 命中正则 | gate | eve.dev |
| `equals(expected)` | 深度相等(NaN / Date / 数组 / 对象) | gate | eve.dev |
| `matches(schema)` | Standard Schema / zod 校验 | gate | eve.dev |
| `similarity(expected)` | 归一化 Levenshtein `[0,1]` | **soft, 0.6** | eve.dev |
| `satisfies(pred, label?)` | 自定义谓词 | gate | eve.dev |
| `makeAssertion({ … })` | 自定义断言工厂 | 可配(默认 gate) | eve.dev |
| `excludes(needle, opts?)` | `includes` 取反 | gate | **fasteval 扩展** |
| `isDefined(label?)` | `value != null` | gate | **fasteval 扩展** |
| `isTrue(label?)` / `isFalse(label?)` | 严格等于 `true` / `false` | gate | **fasteval 扩展** |

## 匹配小语言(`ToolMatch`)

`calledTool` / `notCalledTool` 的第二参用同一套部分深度匹配,来源 eve.dev:

- `input` —— 字面量(深度部分匹配)/ 正则(对序列化串)/ 谓词函数;
- `count` —— 精确计数;
- `status` —— 按 `completed` / `failed` / `rejected` 过滤。

## 用量:`t.usage`

`t.usage`(`{ inputTokens, outputTokens, cacheReadTokens?, … }`)—— 累计用量(平铺,agent 中立),`test` 里随时可读,不止 `maxTokens`/`maxCost` 两条断言用得上,也能自己拿字段配 `t.check` 写别的效率断言(如 `t.check(t.usage.outputTokens, satisfies((n) => n < 10_000, "输出不啰嗦"))`)。工作区相关的访问器(`t.sandbox.diff` / `t.sandbox.file` / 沙箱原始句柄 `t.sandbox`)见[工作区断言](#工作区断言tsandbox仅-workspace-能力)。

没有单独的"原始事件流"逃生舱——`t.event(type, { count? })` / `t.notEvent(type)` / `t.eventOrder([...types])` / `t.eventsSatisfy(label, predicate)` 已经覆盖了"规则覆盖不到、直接查事件"的需求,不需要再开一个公开的原始事件数组访问器。要评整段多轮对话,自己把每轮 `turn.message` 收集拼起来传给 judge(见 [Eval Authoring · 多轮里评整段对话](eval-authoring.md#多轮里评整段对话)),不需要转录文本拼接的便利封装。

## 严重级:gate vs soft

- **gate** —— 硬要求,不过 → 整个 eval failed,任何时候都生效。`includes` / `equals` 等默认 gate。
- **soft** —— 质量分,不会单独让 eval 立即 fail。**没有 `.soft()` 这个方法**——`.atLeast(x)` 本身就是 soft:非 `--strict` 下低于 x 仍 `passed`,`--strict` 下才判 `failed`。不调 `.atLeast()` 也不调 `.gate()` 时,走匹配器自己的默认档:`similarity` 默认 soft、阈值 0.6;judge 不带 `.atLeast()` 时默认 soft、没有阈值,纯记分,任何时候都不会 fail。

链式改写:`.gate()` / `.atLeast(x)`——只有这两个。判决规则(Outcome)见 [Scoring · 判决规则](scoring.md#判决规则)。来源 **eve.dev**。

## LLM-as-judge

judge 在 [Scoring · LLM-as-judge](scoring.md#3-llm-as-judge) 详述,这里只记**作用域**与**来源**:

| judge | 作用 | 来源 |
|---|---|---|
| `t.judge.autoevals.closedQA(criteria, { on?, model? })` | 闭合式判断 | autoevals(Braintrust) |
| `t.judge.autoevals.factuality(expected, …)` | 事实一致性 | autoevals(Braintrust) |
| `t.judge.autoevals.summarizes(source, …)` | 是否忠实摘要 | autoevals(Braintrust) |

**只有这三个,没有开放式的 `t.judge.score` / `t.judge.agent`**——judge 收窄成固定的三个 autoevals 评判器,不留一个"随便传句话就能打分"的口子;需要打分的场景要么落进这三个形状,要么用 `t.check` 配 `makeAssertion` 自己写评分函数。

> 「评工作区产物(diff)」不需要单独的方法——用 `t.judge.autoevals.closedQA(criteria, { on: t.sandbox.diff.get(path) })`(仅 workspace 能力时 `t.sandbox` 才存在),材料显式传,跟其它 judge 调用同一套写法。

- **`{ on }`** = 被评的值(默认 `t.reply` = 最后一轮);可传沙箱文件路径或一段字面文本。judge 接口(`{ on }` / 默认 soft)来源 eve.dev。
- **默认材料**:一律默认 `t.reply`(最后一轮)。要评**工作区产物(diff)**,显式传 `{ on: t.sandbox.diff.get(path) }`;要评**整段多轮对话**,自己把每轮 `turn.message` 收集拼起来再传进去——没有 `t.transcript.text()` 这种便利封装,见 [Eval Authoring · 多轮里评整段对话](eval-authoring.md#多轮里评整段对话)。

**这里只挂 `autoevals` 一层,不留 `t.judge.closedQA`/`t.judge.factuality`/`t.judge.summarizes` 这三个平铺别名** —— 查 eve 源码(`packages/eve/src/evals/judge.ts:67-86`)确认了,`buildJudgeContext` 返回值里**只有** `autoevals: { factuality, summarizes, closedQA, sql }`,没有平铺版本。fasteval 当前实现(`src/scoring/judge.ts:268-284`)两个都留了,是重复入口,违反「API 唯一,不做两个做同一件事的 API」这条原则(见 [Eval Authoring · 核心原因](eval-authoring.md#核心原因) 1.2)。这里先把文档改成目标设计——只留 `autoevals.*`——实现按「设计文档先行,代码待迁移」的方式跟上(同一模式见 `t.sandbox.*`,[`3412f9d`](https://github.com/CorrectRoadH/fastevals/commit/3412f9dfdd6dc3a74dbb1e624a6116459c986340))。顺带一提,eve 的 `autoevals` 下还有一个 `sql` grader,fasteval 目前没有对应物,不在这次改动范围内。

## 来源一览 & 哪些是 fasteval 自创

| 来源 | 给了 fasteval 什么 | 出处 |
|---|---|---|
| **eve.dev evals** | 声明式 DX、路径即身份、gate/soft 分层、scoped / value / turn 断言形态、`t.check`/`require`、匹配器、LLM-judge 接口 | `docs/architecture.md:95`、`docs/README.md:15` |
| **Vercel agent-eval** | Adapter / Sandbox 工程形状、沙箱断言(`fileChanged` / `scriptPassed`/…)、transcript 归一化与可观测、experiment 层、本地 `fasteval view` | `docs/vision.md:79`、`docs/experiments.md:10` |
| **crabbox** | capability 分发纪律、`--budget` / `maxCost` 的 spend cap、source-map 文档观 | `docs/vision.md:9,80`、`docs/runner.md:50` |
| **autoevals(Braintrust)** | `closedQA` / `factuality` / `summarizes` 评判器 | `src/scoring/judge.ts:7-10` |

**fasteval 自创(不在以上任何来源里):**

- **成本聚合** —— 用量 → 成本价格表估算 + `t.maxCost()`(eve 不聚合成本、agent-eval 只留了 TODO,fasteval 补齐;预算护栏的 spend-cap 思路借鉴 crabbox)。
- **匹配器扩展** —— `excludes` / `isDefined` / `isTrue` / `isFalse`。
- **可本地化的项目 `name`、读结果目录出图的 `fasteval view`。**

## 接下来读什么

- [Eval Authoring](eval-authoring.md) —— 怎么把这些断言组织进单轮 / 多轮 / 数据集 eval。
- [Scoring](scoring.md) —— 判决规则、judge 细节、效率 / 成本断言。
- [Agents 与 Adapters](agents-and-adapters.md) —— 断言读的标准事件流从哪来。
- [Observability](observability.md) —— transcript / usage / cost 的数据来源。
