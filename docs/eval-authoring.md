# Authoring —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。这一篇按这个顺序教:单轮、多轮、数据集扇出,以及沙箱型 eval 怎么手工把文件放进沙箱。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Scoring](scoring.md)。

## 设计依据:为什么对齐 eve 的接收者模型

以下是内部设计依据,用于解释 API 取舍;作者写 eval 的直接用法从 [`defineEval` 的形状](#defineeval-的形状) 一节开始。

<--手动维护，不允许删改本段内容，只允许添加-->
# 核心原因
1. API应该容易理解，不会有二义性
1.1 负面例子，`t.messageIncludes(token)` 和 `t.calledTool(name, opts?)` 其它同样的断言API应该都是有同样语义的(比如同指是最后一次t.send，返回的消息，而不是有的是全部，有的是单轮)。如果用户想对整个消息进行评估，可以自己拼接、保存每轮的回复。
1.2 API唯一，如无必要，不应该有两个做一样事的API。

2. 给用户自组织的能力，而不是约定大于配置。用户不想学太多约定。
2.1 比如能不能把fixture、workspace(拷文件。通过基本API让用户自己去处理，而不是我们给一个值，让过程黑箱)
2.2 用户在用 langfuse、promptfoo 这种传统的 prompt 评估，有一些问题，像 dataset、golden，不是很适用于 Agent 的 case。 Agent eval可能更关注多轮对话、同时可能不同case的评估内容也不一样。所以统一的dataset。input与execpt output不太行。
2.2.1 如果用户真的需要dataset，可以通过for来实现这个功能
eve是怎么做到这个的
```ts
import { defineEval } from "eve/evals";
import { loadYaml } from "eve/evals/loaders";
import { equals } from "eve/evals/expect";
const doc = await loadYaml("evals/data/cases.yaml");
const rows = doc.evals as readonly { task: string; prompt: string; sql: string }[];
export default rows.map((row) =>
  defineEval({
    description: row.task,
    async test(t) {
      await t.send(row.prompt);
      t.succeeded();
      t.check(t.reply, equals(row.sql));
    },
  }),
```
<--end-->

### 补充:作用域按接收者决定,对齐 eve

核对 eve 源码(本机 `/Users/ctrdh/Code/eve/packages/eve/src/evals/`)后,把 1.1 说的"作用域"坐实成经验证的设计,订正上一版的误读。

**eve 的真实实现**:`assertions/scoped.ts` 的 `createScopedAssertions` 是**一份实现**,导出 `succeeded` / `messageIncludes` / `calledTool` / `notCalledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls` / `calledSubagent` / `noFailedActions` / `event` / `notEvent` / `eventOrder` / `eventsSatisfy` / `parked` 这一整套,靠调用时绑定的 `scope` 决定读哪份数据,一共绑在三个地方:

- `context.ts:77`:`t` 自己绑 `{ timing: "final", select: (result) => result }`。`result` 是 `EveEvalTaskResult`,由 `runner/execute-task.ts:98`(`buildTaskResult`)构造:`events: input.sessions.flatMap(session => session.events)` —— **把这次 eval run 涉及的全部 session(含 `t.newSession()` 开的)的全部轮次拍平合并**,在 `test()` 跑完、`collector.finalize(result)` 时才求值。
- `session.ts:73-83`:`t.newSession()` 返回的 session 也绑同一套断言,但它是 snapshot scope,只看这个 session 在断言记录时已经发生的事件。
- `session.ts:298-308`(`EvalTurn` 构造函数):`t.send()` 返回的 turn 对象绑 `{ timing: "snapshot", select: () => this.#assertionSubject() }`,`#assertionSubject()` 只读**这一轮自己的** `events`(`session.ts:221-243` 的 `#recordTurn` 传入的就是这次 `send()` 的 `result.events`,不含之前轮次)。

这些绑定共享**同一套完整函数**,区别只是"挂在哪个对象上",不是"叫什么名字"——eve 没有"`messageIncludes` 天生看全部、`calledTool` 天生看单轮"这种按名字区分的不一致。1.1 要避免的正是这种不一致,eve 靠"位置决定作用域、每个位置给全套词汇"解决,不是靠"取消聚合"解决。

**niceeval 对齐到这个设计,不是取消聚合**:

- `t.*` 保留"聚合整个 eval run"的语义——这次 eval 执行的全部轮次、含 `t.newSession()` 开的额外 session,直接对应 eve 的 `timing: "final"` 层。这一层聚合是有意为之,不是要移除的"黑箱"。
- `session.*`(`t.newSession()` 的返回值)复用 `t.*` 的同一套**作用域断言词汇**,但只看这个 session 在断言记录时已有的事件。
- `turn.*`(`t.send()` 的返回值)也复用同一套**作用域断言词汇**,但只看这一轮自己的事件和用量,不再是旧版文档里的 4 个手写方法。`turn.outputEquals` / `turn.outputMatches` 是 turn 独有的(只对单轮结果有意义,聚合层不需要),继续保留。

也就是:**接收者决定作用域,不是断言名字决定作用域。** author-facing 接收者是 `t` / `session` / `turn`;`Attempt` 只作为 runner/result 里的执行单位存在,不是写 eval 时要操作的一层。完整清单见 [Assertions · 作用域规则](assertions.md#作用域规则)。

## `defineEval` 的形状

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description?: string;            // 人读的描述,出现在报告里
  tags?: string[];                 // 供 --tag 过滤
  judge?: JudgeConfig;             // 覆盖默认裁判模型
  reporters?: Reporter[];          // 这个 eval 专用的报告器
  timeoutMs?: number;              // 覆盖默认超时
  metadata?: Record<string, unknown>;
  async test(t) { /* 交互 + 断言 */ },
});
```

**禁止**提供 `id` / `name` —— 它们从文件路径推导:`evals/weather/brooklyn.eval.ts` → id `weather/brooklyn`。改名即改 id,不会腐烂。

## 单轮

```typescript
// evals/weather/brooklyn.eval.ts
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "布鲁克林天气查询",
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");

    // run 级聚合断言:在 test 结束后,对本次 eval run 聚合评估
    t.succeeded();
    t.calledTool("get_weather", { input: { city: "Brooklyn" }, count: 1 });

    // 值级断言:就地、立即评估
    t.check(t.reply, includes("晴"));
  },
});
```

`t.reply` 是最后一条 assistant 消息;`t.sessionId` 是当前主会话 id;`t.events` 是主 session 目前捕获到的强类型事件流。`t.send(input)` 接受字符串或结构化消息,返回一个不可变的 **Turn**,带 `message` / `data`(结构化输出)/ `toolCalls` / `status` / `events`。带本地文件的一轮用 `t.sendFile(path, text?)`,文件会作为 data URL 附加到这一轮输入里,MIME 类型按 `path` 扩展名推断。

## 多轮

把每一轮的返回赋给局部变量,顺着断言:

```typescript
// evals/draft-then-send.eval.ts
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "先拟稿,确认后再发送",
  async test(t) {
    const draft = await t.send("帮我拟一封跟进邮件。");
    draft.succeeded();                         // 只看这一轮:失败就记一条断言
    t.check(draft.message, includes("此致"));
    draft.judge.autoevals.closedQA("语气是否专业").atLeast(0.6);

    await t.send("好,发出去。");
    t.calledTool("send_email");
  },
});
```

需要并行的独立会话时用 `t.newSession()` 开一条互不干扰的对话线。新 session 有同一套 drive API(`send` / `sendFile` / `respond` / `events`)、同一套作用域断言和 `session.judge`;它自己的 `session.*` / `session.judge` 只看这条 session,但事件仍会汇入 `t.*` run 级断言。

### HITL / 待输入请求

当 agent 停在用户输入、审批或选项选择上时,用 `requireInputRequest` 把这个状态变成 gate,再用 `respond` 或 `respondAll` 继续下一轮:

```typescript
const draft = await t.send("先拟稿,发出前让我确认。");
draft.parked();

const request = t.requireInputRequest({
  prompt: /是否发送/,
  optionIds: ["approve", "reject"],
});

await t.respond({ request, optionId: "approve" });
t.calledTool("send_email");
```

如果当前轮有多个同类待处理请求,并且都选同一个选项,用 `respondAll(optionId)`:

```typescript
await t.send("把这批改动逐项提交审批。");
t.requireInputRequest({ display: /审批/ });

await t.respondAll("approve");
t.succeeded();
```

### 多轮里评整段对话

多轮里要分清 judge 的接收者:`t.judge` / `session.judge` 是 session 级,默认评对应 session 的对话;`turn.judge` 才是 turn 级,默认只评这一轮的 `turn.message`。完整的作用域规则与每条断言看哪一轮,见 [Assertions · 作用域规则](assertions.md#作用域规则)。

要让 judge 评「整段多轮对话」(典型:跨轮一致性),直接挂在 `t.judge` 上;要只评某一轮,挂在那一轮的 `turn.judge` 上:

```typescript
const turn1 = await t.send("这张图里有什么?");          // 第一轮:看图
const turn2 = await t.send("背景是什么颜色?");          // 第二、三轮:纯文字追问,考跨轮记忆
const turn3 = await t.send("中间那个形状是什么颜色的?");

t.judge.autoevals
  .closedQA("助手是否始终基于第一轮的图片作答?")
  .atLeast(0.7);

turn3.judge.autoevals.closedQA("这一轮是否回答了形状颜色?").gate();
```

如果要评 sandbox diff、文件内容或其它不是会话本身的材料,仍然用 `{ on }` 显式传值。

## 数据集扇出

一个文件默认导出**一个数组**,就扇出成多个 eval。这是写数据集的规范方式:

```typescript
// evals/sql.eval.ts
import { defineEval } from "niceeval";
import { loadYaml } from "niceeval/loaders";
import { equals } from "niceeval/expect";

const doc = await loadYaml("evals/data/sql-cases.yaml");
const rows = doc.cases as { task: string; prompt: string; sql: string }[];

export default rows.map((row) =>
  defineEval({
    description: row.task,
    async test(t) {
      await t.send(row.prompt);
      t.succeeded();
      t.check(t.reply, equals(row.sql));
    },
  }),
);
```

```yaml
# evals/data/sql-cases.yaml
cases:
  - task: 统计用户数
    prompt: 查出 users 表的总行数
    sql: SELECT COUNT(*) FROM users;
  - task: 最近订单
    prompt: 查出最近 10 条订单
    sql: SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;
```

生成的 id:`sql/0000`、`sql/0001`……(零填充 4 位,稳定可引用)。`loadJson` 同理。

## Agent 由 experiment 选择

eval 默认保持 agent-neutral,只描述"测什么"和"怎么算对"。agent 由 `experiments/` 里的 `defineExperiment` 选择,它的能力决定 `t` 能干什么:

```typescript
// experiments/local.ts
export default defineExperiment({
  agent: myAgent,
  runs: 1,
});
```

常规运行时,agent 由 experiment 提供 —— 这让同一份 eval 能换着被测对象跑(本地 vs 部署、agent A vs agent B),同时运行配置可签入、可复现。怎么写一个 agent,详见 [Adapter 写法](adapters/authoring.md)。

## 沙箱型:手工把文件放进沙箱

评一个 coding agent 时,eval 仍然是普通的 `defineEval`,只是多了沙箱能力:`test(t)` 里的 `t` 多出 `t.sandbox`(前提是 agent 声明了 sandbox capability;见 [Sandbox](sandbox.md))。

**没有自动发现,也没有隐式拷贝**——起始文件只有一种方式:在 `test(t)` 里显式调用 `t.sandbox.writeFiles` / `t.sandbox.uploadFiles` / `t.sandbox.uploadDirectory` 写进沙箱。`t.sandbox` 是 eval 作者使用的沙箱 API,分三类:文件 IO(`writeFiles` / `uploadDirectory` / `readFile`)、命令执行(`runCommand` / `runShell`)和结果断言 / diff(`fileChanged` / `diff` / `file`)。文件从哪读、写到沙箱里哪个路径,全部是你写在 `test(t)` 里的普通代码——不存在"运行器悄悄拷贝一个目录"这种黑箱,你想放哪就写哪,不想放的就不写。路径全部用相对路径写:沙箱侧相对路径解析到 workdir(agent 的工作目录,也是 git 基线和 diff 采集的锚点),省略 `targetDir` / `cwd` 就是它;不要 hardcode 某个 provider 的绝对路径,详见 [Sandbox · 路径与 workdir](sandbox.md#路径与-workdir一个坐标系):

```typescript
// evals/refactor.eval.ts
import { defineEval } from "niceeval";
import { commandSucceeded, includes } from "niceeval/expect";
import { readFileSync } from "node:fs";

export default defineEval({
  description: "把回调改写成 async/await",
  async test(t) {
    await t.sandbox.writeFiles({
      "src/legacy.js": readFileSync("fixtures/legacy-callbacks/legacy.js", "utf-8"),
    });

    await t.send("把 src/legacy.js 里的回调全部改写成 async/await,保持行为不变。");
    const test = await t.sandbox.runCommand("npm", ["test"]);

    t.sandbox.fileChanged("src/legacy.js");
    t.check(t.sandbox.diff.get("src/legacy.js"), includes("await"));
    t.check(test, commandSucceeded());
  },
});
```

**要放一整个文件夹**(比如带 `package.json` + 多个源文件的起始项目),用 `uploadDirectory(localDir, targetDir?)`。第一个参数是宿主机上的本地目录(相对路径解析到 eval 定义文件所在目录);第二个参数是 sandbox 内目标目录,省略就是 workdir——上传完整起始项目时就该省略:

```typescript
export default defineEval({
  description: "实现 Button 组件",
  async test(t) {
    await t.sandbox.uploadDirectory("fixtures/button-starter");

    await t.send("在 src/components/Button.tsx 导出一个 Button 组件,接受 label 和 onClick 两个 prop。");
    // ...
  },
});
```

`writeFiles` 适合少量内联文本文件;`uploadFiles` 适合已经组织成文件数组的文本 / 二进制文件;`uploadDirectory` 适合直接把宿主机上的 fixture 项目、模板项目或测试目录递归放进 sandbox。

数据集扇出时,要写入沙箱的内容跟着数据行走,仍然是同一套写法,不需要另一种"动态 fixture"概念:

```typescript
const rows = [{ file: "a.ts", content: "..." }, { file: "b.ts", content: "..." }];

export default rows.map((row) =>
  defineEval({
    description: `写入 ${row.file}`,
    async test(t) {
      await t.sandbox.writeFiles({ [row.file]: row.content });
      await t.send(`审查 ${row.file}`);
      const test = await t.sandbox.runCommand("npm", ["test"]);
      t.check(test, commandSucceeded());
    },
  }),
);
```

**防作弊靠调用顺序,不靠框架黑箱**:验证用的测试文件(比如 `button.test.ts`)在 `t.send(...)` **之后**才写进沙箱、才运行——agent 那一轮已经结束,天然看不到,不需要"source files vs test files"这种运行器自动拆分/隐藏的机制:

```typescript
export default defineEval({
  description: "实现 Button 组件",
  async test(t) {
    await t.sandbox.writeFiles({ "package.json": PACKAGE_JSON });
    await t.send("在 src/components/Button.tsx 导出一个 Button 组件,接受 label 和 onClick 两个 prop。");

    // agent 跑完之后才放测试文件、才跑测试——全程手工可见,没有隐藏逻辑
    await t.sandbox.writeFiles({ "button.test.ts": BUTTON_TEST_SOURCE });
    const test = await t.sandbox.runCommand("npm", ["test"]);
    t.check(test, commandSucceeded());
  },
});
```

`t.sandbox` 这一个命名空间下按语义分组:`writeFiles` / `uploadFiles` / `runCommand` 是立即 IO / 命令;`fileChanged` / `fileDeleted` / `notInDiff` / `diff` / `file` 是结果视图和延迟断言。`stop()` 这类生命周期动作不暴露给 eval 作者,由 runner 管。要用 judge 评 sandbox 产物,直接 `t.judge.autoevals.closedQA(criteria, { on: t.sandbox.diff.get(path) })`。完整列表见 [Assertions · API 分组速查](assertions.md#api-分组速查)。沙箱创建时运行器已经打好一次空 git 基线,所以 `t.sandbox.diff` / `t.sandbox.fileChanged` 不依赖你怎么写入起始文件、写了没有,随时可读。

## 命名与组织约定

- 文件名以 `.eval.ts` 结尾才会被发现。
- 用目录表达分组:`evals/billing/refund.eval.ts` → `billing/refund`。
- 数据集放 `evals/data/`,沙箱型 eval 要写入的起始文件素材可以放 `evals/fixtures/`(纯目录命名约定,运行器不会扫描或自动加载它——仍要在 `test()` 里手工 `t.sandbox.writeFiles`/`uploadFiles` 读取写入)。
- `description` 写给人看,id 给机器引用。

## 相关阅读

- [Assertions](assertions.md) —— `t.check` / 作用域断言的完整速查表(看哪一轮、来源哪里)。
- [Scoring](scoring.md) —— judge 细节、测试即评分、判定规则。
- [Agents 与 Adapters](adapters/README.md) —— agent 三类 transport 与 agent 适配。
- [CLI](cli.md) —— 过滤、重试、并发等运行标志。
