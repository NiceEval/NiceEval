# Authoring —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。这一篇按这个顺序教:单轮、多轮、数据集扇出,以及沙箱型 eval 的 workspace seed。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Scoring](scoring.md)。

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

### 补充:哪些 API 是作用域断言,哪些是值级 / 轮级

查了 eve 源码(`packages/eve/src/evals/`)和 fasteval 自己的实现(`src/`),把 1.1 说的"作用域"坐实成具体名单,并核对两边是不是真的同一套东西(不发明新名字,直接用两边源码里各自的名字):

**eve**:`assertions/scoped.ts` 的 `createScopedAssertions` 是**一份实现**,靠调用时绑定的 `scope` 决定看多少轮:

- `context.ts:77`:`t` 上绑 `{ timing: "final", select: (result) => result }` —— 整次运行的聚合结果,`messageIncludes`/`calledTool`/... 在这个绑定下扫**全部轮**。
- `session.ts:75-83`、`session.ts:300-305`:每个 turn handle 上绑 `{ timing: "snapshot", select: () => 这一轮 }` —— **同一批函数**(`succeeded` / `messageIncludes` / `calledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls` / `loadedSkill` / `calledSubagent` / `noFailedActions` / `event` / `notEvent` / `eventOrder` / `eventsSatisfy`),换成只看这一轮。

所以在 eve 里,`messageIncludes` 不是"天生等于全部轮",而是**同一份实现,挂在 `t` 上就是整次运行、挂在某个 turn 上就是这一轮**——语义没变,变的是绑定的数据范围。

**fasteval 不是这样实现的**——这是我上一版说错的地方,这里订正:

- `src/scoring/scoped.ts` + `src/context/context.ts:150-193`:`t` 上的 `succeeded`/`messageIncludes`/`calledTool`/… 全部走 `import * as Scoped from "../scoring/scoped.ts"`,名字直接对应 eve 的 `scoped.ts`,这是"作用域断言"这个叫法的来源,不是我们发明的词。这批函数固定只在整次运行的聚合数据上求值,代码里**没有** `timing`/`scope` 这种参数化概念。
- `src/context/context.ts:225-272` 的 `makeTurnHandle`:`turn.messageIncludes` 是**单独手写**的一份 `collector.record({...})`,直接过滤 `turn.events`——跟 `Scoped.messageIncludes` 是两份不同的代码,**没有复用**。`turn` 上只有 `expectOk` / `outputEquals` / `outputMatches` / `messageIncludes` 四个,`TurnHandle`(`src/types.ts:745`)没有 `calledTool`/`succeeded`/`toolOrder` 之类的轮级版本。

也就是说 fasteval 目前没有 eve 那种"一份实现、两种绑定"的复用——作用域断言(`Scoped` 模块,扫全部轮)和轮级断言(`makeTurnHandle`,只看这一轮)是两块完全独立的代码,轮级能力也比 eve 窄。要按 eve 的对称设计补齐(比如加 `turn.calledTool`),是一次要改 `TurnHandle` 接口 + 实现的真实变更,不是文档措辞问题。

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

    // 作用域断言:在 test 结束后,对整次运行评估
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

多轮最容易踩的坑:**judge 默认只看最后一轮**(`t.reply`),而 `t.messageIncludes` 这类作用域断言看的是**所有轮**——作用域不一致。完整的「三层作用域」规则与每条断言看哪一轮,见 [Assertions · 作用域:三层](assertions.md#作用域三层看哪一轮)。

要让 judge 评「整段多轮对话」(典型:跨轮一致性),别用默认材料,把全程对话拼出来显式喂进去:

```typescript
await t.send("这张图里有什么?");          // 第一轮:看图
await t.send("背景是什么颜色?");          // 第二、三轮:纯文字追问,考跨轮记忆
await t.send("中间那个形状是什么颜色的?");

// judge 默认 on: t.reply(最后一轮)。要评"整段三轮",传整段对话:
t.judge
  .score("助手是否始终基于第一轮的图片作答?", { on: t.transcript.text() })
  .atLeast(0.7);
```

`t.transcript.text()` 把整次运行的对话拼成 `role: text` 多行文本;需要更原始的控制就用 `t.transcript.events()` 自己过滤拼接。

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

## 沙箱型:workspace 起始文件 + 动态 seed

评一个 coding agent 时,eval 仍然是普通的 `defineEval`,只是多了沙箱能力:`test(t)` 里的 `t` 多出工作区断言和 `t.sandbox`(前提是 agent/sandbox 声明了 workspace capability;见 [Sandbox](sandbox.md))。seed 沙箱起始文件有两种方式,按需组合:

**静态 seed —— `workspace` 字段**:结构固定、跟着仓库签入的起始代码,直接在 `defineEval` 上指一个目录,运行器会在 agent 跑之前把它拷进沙箱(并打 git 基线,供之后 diff):

```typescript
// evals/refactor.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "把回调改写成 async/await",
  workspace: "./fixtures/legacy-callbacks",   // 起始文件相对项目根
  async test(t) {
    await t.send("把 src/legacy.js 里的回调全部改写成 async/await,保持行为不变。");
    t.fileChanged("src/legacy.js");
    t.check(t.diff.get("src/legacy.js"), includes("await"));
    t.scriptPassed("test");                    // 跑 npm run test,断言退出 0
  },
});
```

**动态 seed —— `t.sandbox.writeFiles` / `uploadFiles`**:内容要跟着数据行算(比如数组扇出的多个变体,每个 seed 内容不同),`workspace` 这种指向固定目录的字段做不到,直接调 `t.sandbox` 上的原语——`t.sandbox` 就是沙箱的原始句柄(`runCommand` / `runShell` / `readFile` / `writeFiles` / `uploadFiles` / `getWorkingDirectory` / `setWorkingDirectory` / `stop`,完整列表见 [Sandbox · 统一接口](sandbox.md#统一接口)),不是一层包装:

```typescript
const rows = [{ file: "a.ts", content: "..." }, { file: "b.ts", content: "..." }];

export default rows.map((row) =>
  defineEval({
    description: `seed ${row.file}`,
    async test(t) {
      await t.sandbox.writeFiles({ [row.file]: row.content });
      await t.send(`审查 ${row.file}`);
      t.testsPassed();
    },
  }),
);
```

两种方式不冲突:`workspace` 负责"跟仓库签入的起始状态",`t.sandbox.writeFiles` / `uploadFiles` 负责"运行时按参数算出来的补充文件"——都走同一条上传路径,没有黑箱转换。工作区断言(`t.fileChanged` / `t.fileDeleted` / `t.notInDiff` / `t.testsPassed` / `t.scriptPassed` / `t.noFailedShellCommands` / `t.diff`)和 agent-as-judge(`t.judge.agent`)都挂在 `t` 顶层,不在 `t.sandbox` 下 —— `t.sandbox` 专指沙箱原始句柄。完整列表见 [Assertions · 工作区断言](assertions.md#工作区断言t-顶层仅-workspace-能力)。

### 磁盘型 fixture(路线图,未实现)

"一个目录一个 eval"(`evals/fixtures/create-button/` 下放 `PROMPT.md` + `EVAL.ts`,靠目录结构自动发现、无需 `.eval.ts`)和它的编程式等价物 `defineAgentEval` 是设计中的沙箱型第二条主轴,规划在 [Roadmap · M3](roadmap.md#m3--竖切沙箱里的-coding-agent第二条主轴) / [M4](roadmap.md#m4--agent-评测的工程化),**当前代码里都不存在** —— `src/` 没有 `PROMPT.md` 扫描、没有 `defineAgentEval`、也没有把 o11y 摘要注入沙箱的 `__fasteval__/results.json`。现在要评 coding agent,用上面的 `defineEval` + `workspace` + `t.sandbox` 组合。

## 命名与组织约定

- 文件名以 `.eval.ts` 结尾才会被发现。
- 用目录表达分组:`evals/billing/refund.eval.ts` → `billing/refund`。
- 数据集放 `evals/data/`,沙箱型 eval 的起始文件放 `evals/fixtures/`(约定,非强制)。
- `description` 写给人看,id 给机器引用。

## 相关阅读

- [Assertions](assertions.md) —— `t.check` / 作用域断言的完整速查表(看哪一轮、来源哪里)。
- [Scoring](scoring.md) —— judge 细节、测试即评分、判决规则。
- [Agents 与 Adapters](agents-and-adapters.md) —— agent 三类 transport 与 agent 适配。
- [CLI](cli.md) —— 过滤、重试、并发等运行标志。
