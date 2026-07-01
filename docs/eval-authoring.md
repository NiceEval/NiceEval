# Authoring —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。这一篇按这个顺序教:单轮、多轮、数据集扇出,以及沙箱型 eval 怎么手工把文件放进沙箱。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Scoring](scoring.md)。

核心 DX 参考  eve

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

### 补充:作用域只有两层,一套词汇,对齐 eve

核对 eve 源码(本机 `/Users/ctrdh/Code/eve/packages/eve/src/evals/`)后,把 1.1 说的"作用域"坐实成经验证的设计,订正上一版的误读。

**eve 的真实实现**:`assertions/scoped.ts` 的 `createScopedAssertions` 是**一份实现**,导出 `succeeded` / `messageIncludes` / `calledTool` / `notCalledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls` / `calledSubagent` / `noFailedActions` / `event` / `notEvent` / `eventOrder` / `eventsSatisfy` / `parked` 这一整套,靠调用时绑定的 `scope` 决定读哪份数据,一共绑在两个地方:

- `context.ts:77`:`t` 自己绑 `{ timing: "final", select: (result) => result }`。`result` 是 `EveEvalTaskResult`,由 `runner/execute-task.ts:98`(`buildTaskResult`)构造:`events: input.sessions.flatMap(session => session.events)` —— **把这次 eval 执行涉及的全部 session(含 `t.newSession()` 开的)的全部轮次拍平合并**,在 `test()` 跑完、`collector.finalize(result)` 时才求值。
- `session.ts:298-308`(`EvalTurn` 构造函数):`t.send()` 返回的 turn 对象绑 `{ timing: "snapshot", select: () => this.#assertionSubject() }`,`#assertionSubject()` 只读**这一轮自己的** `events`(`session.ts:221-243` 的 `#recordTurn` 传入的就是这次 `send()` 的 `result.events`,不含之前轮次)。

两处绑定共享**同一套完整函数**,区别只是"挂在哪个对象上",不是"叫什么名字"——eve 没有"`messageIncludes` 天生看全部、`calledTool` 天生看单轮"这种按名字区分的不一致。1.1 要避免的正是这种不一致,eve 靠"位置决定作用域、每个位置给全套词汇"解决,不是靠"取消聚合"解决。

**fasteval 对齐到这个设计,不是取消聚合**:

- `t.*` 保留"聚合整个 attempt"的语义——这次 eval 执行至今的全部轮次、含 `t.newSession()` 开的额外会话,直接对应 eve 的 `timing: "final"` 层。`t` 就是 attempt 的句柄,这一层聚合是有意为之,不是要移除的"黑箱"。
- `turn.*`(`t.send()` 的返回值)补全成跟 `t.*` **同一套完整词汇**(`turn.calledTool` / `turn.succeeded` / `turn.notCalledTool` / `turn.toolOrder` / `turn.usedNoTools` / `turn.maxToolCalls` / `turn.noFailedActions` / `turn.event` / `turn.notEvent` / `turn.eventOrder` / `turn.eventsSatisfy` / `turn.calledSubagent` / `turn.parked`),不再是旧版文档里的 4 个手写方法。`turn.expectOk` / `turn.outputEquals` / `turn.outputMatches` 是 turn 独有的(只对单轮有意义,聚合层不需要),继续保留。

也就是:**只有两层——`t`(attempt 全程聚合)和 `turn`(这一轮)——每层给同一套断言名字,作用域由你调用在哪个对象上决定,不由断言叫什么名字决定。** 不引入第三层"session 级"(eve 的 `newSession()` 返回值也带这套词汇,但 fasteval 目前不需要跟进这一层——`t.newSession()` 只用来开一条新会话线,不额外暴露带作用域断言的 session 句柄)。完整清单见 [Assertions · 作用域](assertions.md#作用域两层同一套词汇)。

## `defineEval` 的形状

```typescript
import { defineEval } from "fasteval";

export default defineEval({
  description?: string;            // 人读的描述,出现在报告里
  agent?: string;                  // 可选 eval-local 默认;常规运行由 experiment 选择 agent
  tags?: string[];                 // 供 --tag 过滤
  judge?: JudgeConfig;             // 覆盖默认评判模型
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
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "布鲁克林天气查询",
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");

    // 作用域断言:在 test 结束后,对整个 attempt 评估
    t.succeeded();
    t.calledTool("get_weather", { input: { city: "Brooklyn" }, count: 1 });

    // 值级断言:就地、立即评估
    t.check(t.reply, includes("晴"));
  },
});
```

`t.reply` 是最后一条 assistant 消息;`t.send(...)` 返回一个不可变的 **Turn**,带 `message` / `data`(结构化输出)/ `toolCalls` / `status`。

## 多轮

把每一轮的返回赋给局部变量,顺着断言:

```typescript
// evals/draft-then-send.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "先拟稿,确认后再发送",
  async test(t) {
    const draft = await t.send("帮我拟一封跟进邮件。");
    draft.expectOk();                          // 上一轮若失败,这里抛
    t.check(draft.message, includes("此致"));
    t.judge.autoevals.closedQA("语气是否专业", { on: draft.message }).atLeast(0.6);

    await t.send("好,发出去。");
    t.calledTool("send_email");
  },
});
```

需要并行的独立会话时用 `t.newSession()` 开一条互不干扰的对话线。

### 多轮里评整段对话

多轮最容易踩的坑:**judge 默认只看最后一轮**(`t.reply`),而 `t.messageIncludes` 这类作用域断言看的是**整个 attempt**——这是两条独立的默认规则,不是同一套语义。完整的「两层作用域」规则与每条断言看哪一轮,见 [Assertions · 作用域:两层](assertions.md#作用域两层同一套词汇)。

要让 judge 评「整段多轮对话」(典型:跨轮一致性),别用默认材料,把全程对话拼出来显式喂进去:

```typescript
const turn1 = await t.send("这张图里有什么?");          // 第一轮:看图
const turn2 = await t.send("背景是什么颜色?");          // 第二、三轮:纯文字追问,考跨轮记忆
const turn3 = await t.send("中间那个形状是什么颜色的?");

// judge 默认 on: t.reply(最后一轮)。要评"整段三轮",自己把每轮的回复拼起来:
const wholeConversation = [turn1, turn2, turn3].map((turn) => turn.message).join("\n");
t.judge.autoevals
  .closedQA("助手是否始终基于第一轮的图片作答?", { on: wholeConversation })
  .atLeast(0.7);
```

没有 `t.transcript.text()` 这类拼接便利——手工收集每轮的 `turn.message` 再 `join` 是唯一写法,跟核心原因 1.1 说的"想评整个消息,自己拼接、保存每轮的回复"是同一件事。

## 数据集扇出

一个文件默认导出**一个数组**,就扇出成多个 eval。这是写数据集的规范方式:

```typescript
// evals/sql.eval.ts
import { defineEval } from "fasteval";
import { loadYaml } from "fasteval/loaders";
import { equals } from "fasteval/expect";

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

常规运行时,agent 由 experiment 提供 —— 这让同一份 eval 能换着被测对象跑(本地 vs 部署、agent A vs agent B),同时运行配置可签入、可复现。怎么写一个 agent,详见 [Agents 与 Adapters](agents-and-adapters.md)。

## 沙箱型:手工把文件放进沙箱

评一个 coding agent 时,eval 仍然是普通的 `defineEval`,只是多了沙箱能力:`test(t)` 里的 `t` 多出 `t.sandbox`(工作区断言 + 沙箱原始句柄,前提是 agent/sandbox 声明了 workspace capability;见 [Sandbox](sandbox.md))。

**没有自动发现,也没有隐式拷贝**——seed 起始文件只有一种方式:在 `test(t)` 里显式调用 `t.sandbox.writeFiles` / `t.sandbox.uploadFiles`。`t.sandbox` 是沙箱的原始句柄(`runCommand` / `runShell` / `readFile` / `writeFiles` / `uploadFiles` / `getWorkingDirectory` / `setWorkingDirectory` / `stop`,完整列表见 [Sandbox · 统一接口](sandbox.md#统一接口)),不是一层包装。文件从哪读、写到沙箱里哪个路径,全部是你写在 `test(t)` 里的普通代码——不存在"运行器悄悄拷贝一个目录"这种黑箱,你想放哪就写哪,不想放的就不写:

```typescript
// evals/refactor.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";
import { readFileSync } from "node:fs";

export default defineEval({
  description: "把回调改写成 async/await",
  async test(t) {
    await t.sandbox.writeFiles({
      "src/legacy.js": readFileSync("fixtures/legacy-callbacks/legacy.js", "utf-8"),
    });

    await t.send("把 src/legacy.js 里的回调全部改写成 async/await,保持行为不变。");
    t.sandbox.fileChanged("src/legacy.js");
    t.check(t.sandbox.diff.get("src/legacy.js"), includes("await"));

    t.sandbox.scriptPassed("test");             // 跑 npm run test,断言退出 0
  },
});
```

**要放一整个文件夹**(比如带 `package.json` + 多个源文件的起始项目),`t.sandbox` 没有单独的"传文件夹"方法——`writeFiles` / `uploadFiles` 拿的都是一份**文件清单**(路径 → 内容),所以自己用 `node:fs` 把本地目录读成清单,一次性传给 `writeFiles`。目的路径就是清单的 key,想保留目录结构、想拍平、想改名都在这段代码里决定,不是框架的隐藏行为:

```typescript
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function readDirAsFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const abs = join(dir, entry);
    if (statSync(abs).isFile()) files[entry] = readFileSync(abs, "utf-8");
  }
  return files;
}

export default defineEval({
  description: "实现 Button 组件",
  async test(t) {
    await t.sandbox.writeFiles(readDirAsFiles("fixtures/button-starter"));
    await t.send("在 src/components/Button.tsx 导出一个 Button 组件,接受 label 和 onClick 两个 prop。");
    // ...
  },
});
```

`readDirAsFiles` 是普通函数,项目里写一次、到处复用;不是 fasteval 的 API——fasteval 不需要为"传文件夹"单独开方法,`writeFiles` 的文件清单形状已经够表达。二进制文件(图片等)改用 `uploadFiles`(接受 `SandboxFile[]`,可带 `Buffer`),不能用只收文本的 `writeFiles`。

数据集扇出时,seed 内容跟着数据行算是同一套写法,不需要另一种"动态 seed"概念:

```typescript
const rows = [{ file: "a.ts", content: "..." }, { file: "b.ts", content: "..." }];

export default rows.map((row) =>
  defineEval({
    description: `seed ${row.file}`,
    async test(t) {
      await t.sandbox.writeFiles({ [row.file]: row.content });
      await t.send(`审查 ${row.file}`);
      t.sandbox.scriptPassed("test");
    },
  }),
);
```

**防作弊靠调用顺序,不靠框架黑箱**:验证用的测试文件(比如 `button.test.ts`)在 `t.send(...)` **之后**才写进沙箱、才运行——agent 那一轮已经结束,天然看不到,不需要"workspace files vs test files"这种运行器自动拆分/隐藏的机制:

```typescript
export default defineEval({
  description: "实现 Button 组件",
  async test(t) {
    await t.sandbox.writeFiles({ "package.json": PACKAGE_JSON });
    await t.send("在 src/components/Button.tsx 导出一个 Button 组件,接受 label 和 onClick 两个 prop。");

    // agent 跑完之后才放测试文件、才跑测试——全程手工可见,没有隐藏逻辑
    await t.sandbox.writeFiles({ "button.test.ts": BUTTON_TEST_SOURCE });
    t.sandbox.scriptPassed("test");
  },
});
```

工作区断言(`t.sandbox.fileChanged` / `t.sandbox.fileDeleted` / `t.sandbox.notInDiff` / `t.sandbox.scriptPassed` / `t.sandbox.noFailedShellCommands` / `t.sandbox.diff`)和沙箱原始句柄(`writeFiles`/`uploadFiles`/`runCommand`/…)住在同一个 `t.sandbox` 命名空间——来源 Vercel agent-eval。要用 judge 评工作区产物,没有单独的 agent-as-judge 方法,直接 `t.judge.autoevals.closedQA(criteria, { on: t.sandbox.diff.get(path) })`。完整列表见 [Assertions · 工作区断言](assertions.md#工作区断言tsandbox仅-workspace-能力)。沙箱创建时运行器已经打好一次空 git 基线,所以 `t.sandbox.diff` / `t.sandbox.fileChanged` 不依赖你怎么 seed、seed 了没有,随时可读。

## 命名与组织约定

- 文件名以 `.eval.ts` 结尾才会被发现。
- 用目录表达分组:`evals/billing/refund.eval.ts` → `billing/refund`。
- 数据集放 `evals/data/`,沙箱型 eval 要 seed 的起始文件素材放 `evals/fixtures/`(纯目录命名约定,运行器不会扫描或自动加载它——仍要在 `test()` 里手工 `t.sandbox.writeFiles`/`uploadFiles` 读取写入)。
- `description` 写给人看,id 给机器引用。

## 相关阅读

- [Assertions](assertions.md) —— `t.check` / 作用域断言的完整速查表(看哪一轮、来源哪里)。
- [Scoring](scoring.md) —— judge 细节、测试即评分、判决规则。
- [Agents 与 Adapters](agents-and-adapters.md) —— agent 三类 transport 与 agent 适配。
- [CLI](cli.md) —— 过滤、重试、并发等运行标志。
