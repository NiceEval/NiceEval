# Assertions —— 断言参考(作用域 + 来源)

这一篇是断言的速查参考:每条 API 做什么、看哪一轮、属于哪一类。怎么把它们组织进 eval,见 [Eval Authoring](eval-authoring.md);判定规则与 judge 细节见 [Scoring](scoring.md)。

> **来源一句话:** 会话 / 作用域断言 DX 借自 **eve.dev evals**;sandbox / diff 的工程形状借自 **Vercel agent-eval**;`--budget` 等护栏借鉴 **crabbox**;`closedQA` / `factuality` / `summarizes` 直接用 **autoevals(Braintrust)**。

断言是 eval 给 `test(t)` 的产出打分的方式。每条记录一个结果、返回可链式 handle;runner 收齐**所有**记录再算判定,所以一次运行会报告每一条失败断言,而不是遇到第一个就停。

## t、Session 和 Turn

写 eval 时只有三个接收者需要分清:`t`、`session` 和 `turn`。`Attempt` 是 runner/result 里的执行单位,不是一个 author-facing API 对象。

| 接收者 | 含义 | 断言作用域 |
|---|---|---|
| **`t`** | 当前 eval run 的主上下文,同时驱动主 session | `t.succeeded()` / `t.calledTool()` 等看本次运行的全部 session 和全部 turn |
| **Session** | `t.newSession()` 返回的一条独立会话线 | `session.succeeded()` / `session.calledTool()` 等看这个 session 当时已经发生的事件 |
| **Turn** | 一次 `t.send()` 返回的一轮交互结果 | `turn.succeeded()` / `turn.calledTool()` 等只看这一轮自己的事件 |

在**作用域断言**这一层,`t` / `session` / `turn` 就是同一组函数,只是 scope binding 不同。规则是:**作用域由你调用在哪个对象上决定,不由断言名字决定。** `t.newSession()` 返回的是独立 session,但仍属于同一次 eval run;这些 session 的事件会一起进入 `t.succeeded()` / `t.calledTool()` / `t.eventsSatisfy()` 等 `t.*` 断言。

其它子函数按对象职责分开:驱动 API 只在 `t` / `session` 上,结果读取字段按 `t` / `session` / `turn` 各自的数据形状给,`t.check` / `t.sandbox` 这类 run 级能力不下放到 `session` / `turn`。

## API 分组速查

### 会话驱动与控制 API

`t` 与 `session` 共享同一套会话驱动接口:`send` / `sendFile` / `requireInputRequest` / `respond` / `respondAll`。区别是 `t` 驱动主 session,`session` 驱动一条独立 session;只有 `t` 能 `newSession()`。

| API | 作用 | 备注 |
|---|---|---|
| `await t.send(input)` | 给 agent 发一轮输入并等待稳定 | `input` 可以是字符串或结构化消息;返回 `turn` |
| `await t.sendFile(path, text?)` | 给 agent 发带本地文件的一轮输入 | 文件按 `path`(相对项目根)读取,作为 data URL 附加;`text` 是可选的配文文字;MIME 类型按扩展名推断,暂不支持显式覆盖 |
| `t.requireInputRequest(filter?)` | 断言恰好有一个待处理输入请求,并返回它 | gate;filter 可匹配工具名、action input、prompt、display、option ids |
| `await t.respond(...responses)` | 回答待处理输入请求 | 每个 response 是字符串(option id 或自由文本);多个用换行拼接,作为下一轮发送 |
| `await t.respondAll(optionId)` | 用同一 option 回答所有待处理输入请求 | 响应会作为下一轮发送 |
| `t.newSession()` | 开一条独立会话线 | 返回 `session`;事件仍汇入 `t.*` run 级断言 |
| `session.send(input)` | 给独立 session 发一轮输入 | 返回 `turn`;不影响主 session 的 resume 状态 |
| `session.sendFile(path, text?)` | 给独立 session 发带本地文件的一轮输入 | 与 `t.sendFile` 同形,但归属这个 session |
| `session.requireInputRequest(filter?)` | 在这个 session 里断言恰好有一个待处理输入请求 | gate;避免多 session 时误匹配其它 session |
| `await session.respond(...responses)` | 回答这个 session 的指定待处理输入请求 | 与 `t.respond` 同形 |
| `await session.respondAll(optionId)` | 用同一 option 回答这个 session 的所有待处理输入请求 | 与 `t.respondAll` 同形 |

`turn` 是一次 `send` 的不可变结果,不负责继续驱动会话。下一轮仍然从 `t` 或对应 `session` 调 `send` / `respond`。

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description: "主 session 与独立 session 分开驱动",
  async test(t) {
    const mainTurn = await t.send("查一下布鲁克林天气。");

    const other = t.newSession();
    const otherTurn = await other.send("查一下旧金山天气。");

    mainTurn.messageIncludes("Brooklyn");
    otherTurn.messageIncludes("San Francisco");
  },
});
```

### 结果读取字段

| API | 作用 | 备注 |
|---|---|---|
| `t.reply` | 主 session 最后一条 assistant 消息 | 常用于值级 matcher;不是 `t.judge` 的默认材料 |
| `t.sessionId` | 当前主会话 id | adapter 返回时填入;用于 resume / 调试 |
| `t.events` | 主 session 目前已捕获的强类型事件流 | 即时读取主 session;`t.*` 最终断言会聚合全部 session |
| `session.reply` | 这个 session 的最后一条 assistant 消息 | 不读主 session |
| `session.events` | 这个 session 已捕获的事件流 | `session.*` 作用域断言读同一份材料 |
| `session.sessionId` | 这个 session 的 id | adapter 返回时填入;用于 resume / 调试 |
| `turn.message` | 这一轮 assistant 消息 | 多轮 judge 时建议自己收集这些值 |
| `turn.data` | 这一轮结构化输出 | 配 `turn.outputEquals` / `turn.outputMatches` |
| `turn.status` | 这一轮状态 | `completed` / `failed` / `waiting` |
| `turn.events` | 这一轮标准事件流 | 只含这一轮,不含之前轮次 |
| `turn.usage` | 这一轮 token 用量 | 可选,取决于 adapter 能否带回 |

```typescript
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "读取主 session、独立 session 与单轮结果",
  async test(t) {
    const mainTurn = await t.send("查一下布鲁克林天气。");

    const other = t.newSession();
    const otherTurn = await other.send("查一下旧金山天气。");

    t.check(t.reply, includes("Brooklyn"));             // 主 session 最后一条回复
    t.check(other.reply, includes("San Francisco"));    // 独立 session 最后一条回复
    t.check(mainTurn.message, includes("Brooklyn"));    // 第一轮自己的回复
    t.check(otherTurn.message, includes("San Francisco"));
  },
});
```

### 作用域断言共享词汇

下表这些 API 在 `t.*` / `session.*` / `turn.*` 上同名存在。它们应该是同一组函数 / 同一套实现,只更换接收者绑定的数据:

- `t.*`:本次 attempt 的全部 session 和全部 turn,在 `test` 结束后聚合评估。
- `session.*`:这条 session 在断言记录时已经发生的事件。
- `turn.*`:这一轮自己的事件和用量。

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description: "同名断言在 t / session / turn 上只换作用域",
  async test(t) {
    const firstTurn = await t.send("查一下布鲁克林天气。");

    // turn.*:只看第一轮自己的事件和消息
    firstTurn.succeeded();
    firstTurn.calledTool("get_weather", { input: { city: "Brooklyn" } });

    const followup = t.newSession();
    await followup.send("查一下旧金山天气。");

    // session.*:只看 followup 这条独立 session
    followup.succeeded();
    followup.calledTool("get_weather", { input: { city: "San Francisco" } });

    // t.*:test 结束后聚合主 session + followup session 的全部轮次
    t.succeeded();
    t.calledTool("get_weather", { count: 2 });
  },
});
```

| API 后缀 | 作用 | 来源 |
|---|---|---|
| `succeeded()` | 当前作用域没失败、且没卡在未回答的 HITL | eve.dev |
| `parked()` | 当前作用域干净停在 HITL 输入上 | eve.dev |
| `messageIncludes(token)` | 当前作用域 assistant 文本拼接后含 token | eve.dev |
| `calledTool(name, match?)` | 当前作用域有匹配 name / input / status / count 的工具调用 | eve.dev |
| `notCalledTool(name, match?)` | 当前作用域没有匹配的工具调用 | eve.dev |
| `toolOrder(names)` | 当前作用域工具调用按给定子序出现 | eve.dev |
| `usedNoTools()` | 当前作用域完全没调工具 | eve.dev |
| `maxToolCalls(max)` | 当前作用域工具调用数不超过 max | eve.dev |
| `loadedSkill(skill)` | `calledTool("load_skill", { input: { skill } })` 的糖 | eve.dev |
| `calledSubagent(name, match?)` | 当前作用域有匹配子 agent 委派 | eve.dev |
| `noFailedActions()` | 当前作用域没有 failed 的工具 / 子 agent 动作 | eve.dev |
| `event(type, opts?)` | 当前作用域出现某类型事件,可指定 count | eve.dev |
| `notEvent(type)` | 当前作用域没出现某类型事件 | eve.dev |
| `eventOrder(types)` | 当前作用域事件类型按给定子序出现 | eve.dev |
| `eventsSatisfy(label, predicate)` | 自定义谓词直接查当前作用域事件流 | eve.dev |
| `maxTokens(max)` | 当前作用域 input + output token 不超过 max | niceeval |
| `maxCost(usd)` | 当前作用域估算成本不超过 usd | niceeval |

### 接收者专属 API

这些 API 不应该为了表面一致合并,因为它们表达的是不同对象的职责:

| 接收者 | API | 为什么专属 |
|---|---|---|
| `t` | `check` / `require` / `skip` / `log` | 记录 eval run 级断言或控制流,不属于某个 session / turn |
| `t` | `newSession()` | 只有 run 主上下文负责创建额外 session |
| `t` | `sandbox.*` | 沙箱是 attempt / run 资源,不是某条会话或某一轮的资源 |
| `turn` | `outputEquals(value)` / `outputMatches(schema)` | 只对这一轮的 `turn.data` 有意义 |

### 值级断言

`check` 和 `require` 都记录值级断言,但它们不是等价 API。`check` 是"记录并继续":同步返回一个断言句柄,不阻塞后续代码,适合尽量收集多条失败信号。`require` 是"前置条件":立即等待 matcher 结果,通过后返回原 value,不通过就抛出 eval 控制流异常并中止依赖它的后续代码。只有后续逻辑确实依赖这个值或条件时才用 `require`。

**记录 API:**

| API | 作用 | 备注 |
|---|---|---|
| `t.check(value, matcher)` | 同步记录一条值级断言 | 返回 `AssertionHandle`;不等待结果;失败不阻止后续代码 |
| `await t.require(value, matcher)` | 立即等待并要求值通过 matcher | 返回原 `value`;不通过就抛,按 gate 中止后续 |

**Matcher 函数:**

| API | 作用 | 备注 |
|---|---|---|
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

```typescript
import { defineEval } from "niceeval";
import { includes, isDefined } from "niceeval/expect";

export default defineEval({
  description: "check 记录断言,require 作为前置条件",
  async test(t) {
    await t.send("查一下布鲁克林天气。");

    const reply = await t.require(t.reply, isDefined("reply")); // 不满足就中止后续
    t.check(reply, includes("Brooklyn"));                       // 记录一条断言,继续收集其它断言
    t.check(reply, includes("weather"));
  },
});
```

### Sandbox:文件 IO

| API | 作用 | 路径 / 目标 |
|---|---|---|
| `t.sandbox.writeFiles(files, targetDir?)` | 写入文本文件清单 | `targetDir` 省略 → workdir;key 是相对 `targetDir` 的路径 |
| `t.sandbox.uploadFiles(files, targetDir?)` | 写入文本 / 二进制文件清单 | `targetDir` 省略 → workdir;每个文件的 `path` 是相对 `targetDir` 的路径 |
| `t.sandbox.uploadDirectory(localDir, targetDir?, opts?)` | 递归上传宿主机目录 | `localDir` 相对路径解析到 eval 文件所在目录;`targetDir` 省略 → workdir |
| `t.sandbox.readFile(path)` | 读取 sandbox 文件 | 相对路径解析到 workdir |
| `t.sandbox.fileExists(path)` | 判断 sandbox 文件是否存在 | 相对路径解析到 workdir |
| `t.sandbox.readSourceFiles(root?)` | 批量读取源码文件 | `root` 省略 → workdir |

文件 IO 不限制只能写某个目录:只要 provider 允许、权限允许,`targetDir` 可以是 sandbox 内任何可写目录。但常规写法是**省略 `targetDir`**——它默认落到 workdir(agent 的工作目录,也是 git 基线和 diff 采集的锚点),而 workdir 的绝对值随 provider 不同(见 [Sandbox · 路径与 workdir](sandbox.md#路径与-workdir一个坐标系)),hardcode 任何一个 provider 的绝对路径都会让 eval 换 provider 就坏。`writeFiles` / `uploadFiles` 的文件 key 不写绝对路径;目标目录用 `targetDir` 表达,文件 key 只表达该目标目录下的相对路径。必须要绝对路径时(比如拼进 prompt)用 `t.sandbox.workdir`。

### Sandbox:命令执行

| API | 作用 | 备注 |
|---|---|---|
| `t.sandbox.runCommand(cmd, args?, opts?)` | 执行命令并返回结果 | `opts.cwd` 控制工作目录;省略 → workdir;不自动评分 |
| `t.sandbox.runShell(script, opts?)` | 执行 shell 脚本并返回结果 | `opts.cwd` 控制工作目录;省略 → workdir;不自动评分 |

`Sandbox.stop()` 是运行器生命周期职责,不暴露给 eval 作者。eval 只描述“测什么、怎么判分”,不负责销毁沙箱。

### Sandbox:结果断言与 diff

**Sandbox 结果断言:**

| API | 作用 | 备注 |
|---|---|---|
| `t.sandbox.fileChanged(path)` | 文件出现在生成 diff 里 | 延迟断言 |
| `t.sandbox.fileDeleted(path)` | 文件被删除 | 延迟断言 |
| `t.sandbox.notInDiff(re)` | diff 不含某模式 | 延迟断言 |

**Sandbox 结果材料:**

| API | 作用 | 备注 |
|---|---|---|
| `t.sandbox.diff.get(path)` | 读取某文件 diff 内容 | `path` 写 workdir 相对的项目路径(git diff 产出的就是它) |
| `t.sandbox.diff.isEmpty()` | diff 是否为空 | 值级断言材料 |
| `t.sandbox.diff.matches(re)` | diff 是否命中正则 | 值级断言材料 |
| `t.sandbox.file(path)` | 延迟读取 sandbox 文件 | `path` 是 sandbox 内路径;配 `t.check` 使用 |

同一个 `t.sandbox` 下同时有“放文件”和“断言文件变化”,但文档按类别区分:

- 文件 IO 和命令执行是**立即动作**;
- diff / fileChanged / file 是**结果视图和延迟断言**;
- 沙箱创建、清理、停止是**runner 生命周期**,不暴露给 eval 作者。

### Judge

`t.judge` / `session.judge` / `turn.judge` 共享同一套 judge 函数,只换默认材料:

- `t.judge`:默认评主 session 对话。
- `session.judge`:默认评这个独立 session 对话。
- `turn.judge`:默认评这一轮的 `turn.message`。
- `{ on }`:显式覆盖被评材料,用于 sandbox diff、文件内容或其它自定义值。

| API 后缀 | 作用 | 默认材料 |
|---|---|---|
| `judge.autoevals.closedQA(criteria, opts?)` | 闭合式判断 | 接收者默认材料,或 `opts.on` |
| `judge.autoevals.factuality(expected, opts?)` | 事实一致性 | 接收者默认材料,或 `opts.on` |
| `judge.autoevals.summarizes(source, opts?)` | 是否忠实摘要 | 接收者默认材料,或 `opts.on` |

judge 是评分器,默认材料也由接收者决定:`t.judge` / `session.judge` 是 session 级,默认评对应 session 的对话文本;`turn.judge` 是 turn 级,默认只评 `turn.message`。评 sandbox 产物或其它自定义值时,显式传 `t.sandbox.diff.get(path)`、`await t.sandbox.readFile(path)` 或其它 `{ on }` 材料。

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description: "judge 默认材料按接收者决定",
  async test(t) {
    const firstTurn = await t.send("解释今天布鲁克林天气,给出穿衣建议。");

    const other = t.newSession();
    await other.send("解释今天旧金山天气,给出穿衣建议。");

    t.judge.autoevals.closedQA("主 session 的建议是否具体?").atLeast(0.7);
    other.judge.autoevals.closedQA("独立 session 的建议是否具体?").atLeast(0.7);
    firstTurn.judge.autoevals.closedQA("这一轮是否提到了穿衣建议?").gate();

    // 沙箱型 eval 里,也可以用 { on } 显式评 diff / 文件内容。
    const diff = t.sandbox.diff.get("src/weather.ts");
    t.judge.autoevals.closedQA("diff 是否只改了天气逻辑?", { on: diff }).atLeast(0.7);
  },
});
```

## 作用域规则

作用域由你调用在哪个对象上决定,不由断言名字决定。

| 层 | 谁 | 作用域 |
|---|---|---|
| **值级** | `t.check(value, matcher)` / `await t.require(value, matcher)`、judge 的 `{ on }` | 只评你传进去的值;`require` 额外承担前置条件控制流 |
| **run 级聚合** | `t.succeeded()`、`t.calledTool()`、`t.event()` 等 | `test` 跑完后,看本次运行的全部 session 和全部 turn |
| **session 级会话** | `session.succeeded()`、`session.calledTool()`、`session.event()` 等 | 只看这个 session 在断言记录时已有的事件 |
| **turn 级单轮** | `turn.succeeded()`、`turn.calledTool()`、`turn.event()` 等 | 只看这一轮自己的事件 |
| **sandbox 结果级** | `t.sandbox.fileChanged()`、`t.sandbox.diff` 等 | 只看本次 eval run 最终 sandbox diff,不按轮次切分 |

judge 默认材料按接收者分层:`t.judge` / `session.judge` 默认评对应 session 对话;`turn.judge` 默认评当前 turn。要评 sandbox 产物或其它非对话材料,显式传 `{ on }`:

```typescript
const turns = [
  await t.send("这张图里有什么?"),
  await t.send("背景是什么颜色?"),
  await t.send("中间那个形状是什么颜色的?"),
];

t.judge.autoevals.closedQA("助手是否始终基于第一轮的图片作答?").atLeast(0.7);
```

## 命令结果怎么评分

命令执行和评分分开。`runCommand` / `runShell` 只负责执行并返回结果;是否通过,用普通 matcher 表达。

```typescript
import { commandSucceeded, excludes } from "niceeval/expect";

const test = await t.sandbox.runCommand("npm", ["test"]);

t.check(test, commandSucceeded());
t.check(test.stderr, excludes("TypeError"));
```

不保留 `scriptPassed()` / `testsPassed()` 作为目标 DX。它们来自 Vercel agent-eval 的固定 fixture 流程:`PROMPT.md` + `EVAL.ts` + `scripts[]` 由 runner 自动调度。niceeval 的目标形状是“用户在 `test(t)` 里手工写入文件、手工运行验证命令、手工断言命令结果”,所以不再需要一个同时暗示“执行脚本”和“注册断言”的 API。

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

## 来源一览 & 哪些是 niceeval 自创

| 来源 | 给了 niceeval 什么 | 出处 |
|---|---|---|
| **eve.dev evals** | 声明式 DX、路径即身份、gate/soft 分层、t / session / turn 接收者模型、`t.check` / `t.require`、匹配器、LLM-judge 接口 | `docs/architecture.md`、`docs/README.md` |
| **Vercel agent-eval** | Adapter / Sandbox 工程形状、sandbox diff、transcript 归一化与可观测、experiment 层、本地 `niceeval view` | `docs/vision.md`、`docs/experiments.md` |
| **crabbox** | capability 分发纪律、`--budget` / `maxCost` 的 spend cap、source-map 文档观 | `docs/vision.md`、`docs/runner.md` |
| **autoevals(Braintrust)** | `closedQA` / `factuality` / `summarizes` 三个 judge | `src/scoring/judge.ts` |

**niceeval 自创(不在以上任何来源里):**

- **成本聚合** —— 用量 → 成本价格表估算 + `t.maxCost()`。
- **匹配器扩展** —— `excludes` / `isDefined` / `isTrue` / `isFalse` / `commandSucceeded`。
- **judge 接收者默认材料** —— `t.judge` / `session.judge` 评 session;`turn.judge` 评单轮,避免为了单轮 judge 手写 `{ on: turn.message }`。
- **sandbox author API 分层** —— 文件 IO / 命令执行 / 结果断言都在 `t.sandbox`,但生命周期动作如 `stop()` 不暴露给 eval 作者。
- **本地结果查看器** —— 读 `.niceeval/<run>/` 结构化工件出图。

## 接下来读什么

- [Eval Authoring](eval-authoring.md) —— 怎么把这些 API 组织进单轮 / 多轮 / 数据集 / 沙箱型 eval。
- [Scoring](scoring.md) —— 判定规则、judge 细节、效率 / 成本断言。
- [Adapter 契约](adapters/contract.md) —— 断言读的标准事件流从哪来,以及每条断言对 adapter 的数据义务。
- [Observability](observability.md) —— transcript / usage / cost 的数据来源。
