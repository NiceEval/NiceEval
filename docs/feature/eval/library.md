# Eval —— 库用法

`defineEval` 的完整写法:单轮、多轮、HITL、数据集扇出、沙箱型,以及命名约定。核心契约见 [README](README.md)。

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

    // 值断言:就地、立即评估
    t.check(t.reply, includes("晴"));
  },
});
```

`t.reply` 是最后一条 assistant 消息;`t.sessionId` 是当前主会话 id;`t.events` 是主 session 目前捕获到的强类型事件流。`t.send(input)` 接受字符串或结构化消息,返回一个不可变的 **Turn**(字段全集见 [Context · 读取结果](library/context.md#读取结果))。带本地文件的一轮用 `t.sendFile(path, text?)`,文件读成结构化 `InputFile`(`filename` / `mimeType` / `dataBase64`)随 `input.files` 附加到这一轮输入,MIME 类型按 `path` 扩展名推断;怎么变成模型请求由 adapter 决定。

## tags 与 environment：让 experiment 选择

```typescript
// evals/coding/fix-button.eval.ts → id: coding/fix-button
export default defineEval({
  description: "修复 Button 组件",
  tags: ["coding", "frontend"],
  environment: "node-22",
  async test(t) { /* coding task */ },
});

// evals/research/gpu-literature.eval.ts → id: research/gpu-literature
export default defineEval({
  description: "在 GPU 环境检索论文",
  tags: ["research"],
  environment: "gpu",
  async test(t) { /* research task */ },
});
```

`tags` 是可重复使用的分类标签，既供 CLI `--tag` 使用，也会进入 experiment 谓词收到的 `EvalDescriptor`；未声明时是空数组。`environment` 是 provider-neutral 的环境 profile id；experiment 只读取这个 id，具体 image / template 仍由 sandbox spec 的 `environments` 映射。

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
t.requireInputRequest({ prompt: /审批/ });

await t.respondAll("approve");
t.succeeded();
```

### 多轮里评整段对话

多轮里要分清 judge 的接收者:`t.judge` / `session.judge` 是 session 级,默认评对应 session 的对话;`turn.judge` 才是 turn 级,默认只评这一轮的 `turn.message`。完整的作用域规则与每条断言看哪一轮,见 [Scoring · 作用域](../scoring/architecture/scopes.md)。

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

数据集有两种默认导出形状：没有稳定业务标识的行导出**数组**，按位置生成零填充 id；已有外部 case / issue / benchmark id 的行导出 **keyed record**，把业务 key 原样接到文件 id 后。不要为了保留业务 id 复制一批只有参数不同的薄 `.eval.ts` wrapper。

### 数组：位置就是身份

一个文件默认导出数组，就扇出成多个 eval：

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

### Keyed record：业务 key 就是身份

数据源已有稳定 key 时，默认导出 `Record<string, EvalDef>`：

```typescript
// evals/swelancer.eval.ts
const rows = [
  { issue: "15193", prompt: "Review issue 15193" },
  { issue: "25901", prompt: "Review issue 25901" },
];

export default Object.fromEntries(
  rows.map((row) => [
    row.issue,
    defineEval({
      description: `SWE-Lancer ${row.issue}`,
      async test(t) {
        await t.send(row.prompt);
        t.succeeded();
      },
    }),
  ]),
);
```

生成的 id 是 `swelancer/15193`、`swelancer/25901`。key 必须是一个非空路径片段：不能含 `/`、`\\`，不能是 `.` / `..`，也不能含控制字符。发现结果按 key 字典序排列，因此数据源换行、对象构造顺序或上游返回顺序变化都不会改变运行与展示顺序。空 record 合法，表示这份数据集当前没有 case。

选择规则很简单：位置本身有意义且稳定时用数组；外部系统已经给出稳定身份时用 keyed record。两种形状都共享同一份 eval 源码捕获，区别只在 id 的最后一段。

## Agent 由 experiment 选择

eval 默认保持 agent-neutral,只描述"测什么"和"怎么算对"。agent 由 `experiments/` 里的 `defineExperiment` 选择,它的能力决定 `t` 能干什么:

```typescript
// experiments/local.ts
export default defineExperiment({
  agent: myAgent,
  runs: 1,
});
```

常规运行时,agent 由 experiment 提供 —— 这让同一份 eval 能换着被测对象跑(本地 vs 部署、agent A vs agent B),同时运行配置可签入、可复现。怎么写一个 agent,详见 [编写 Adapter](../adapters/library/writing-an-adapter.md);experiment 的完整形状见 [Experiments](../experiments/README.md)。

## 沙箱型:手工把文件放进沙箱

评一个 coding agent 时,eval 仍然是普通的 `defineEval`,只是多了沙箱能力:`test(t)` 里的 `t` 多出 `t.sandbox`(前提是 agent 声明了 sandbox capability;见 [Sandbox](../sandbox/README.md))。

**没有自动发现,也没有隐式拷贝**——起始文件只有一种方式:在 `test(t)` 里显式调用 `t.sandbox.writeFiles` / `t.sandbox.uploadFiles` / `t.sandbox.uploadDirectory` 写进沙箱。`t.sandbox` 是 eval 作者使用的沙箱 API,分三类:文件 IO(`writeFiles` / `uploadDirectory` / `readFile`)、命令执行(`runCommand` / `runShell`)和结果断言 / diff(`fileChanged` / `diff` / `file`)。文件从哪读、写到沙箱里哪个路径,全部是你写在 `test(t)` 里的普通代码——不存在"运行器悄悄拷贝一个目录"这种黑箱,你想放哪就写哪,不想放的就不写。路径全部用相对路径写:沙箱侧相对路径解析到 workdir(agent 的工作目录,也是变更分类账和 agent diff 的锚点),省略 `targetDir` / `cwd` 就是它;不要 hardcode 某个 provider 的绝对路径,详见 [Sandbox · 路径与 workdir](../sandbox/library.md#路径与-workdir一个坐标系):

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

**要放一整个文件夹**(比如带 `package.json` + 多个源文件的起始项目),用 `uploadDirectory(localDir, targetDir?, opts?)`。第一个参数是宿主机上的本地目录(相对路径解析到 eval 定义文件所在目录);第二个参数是 sandbox 内目标目录,省略就是 workdir——上传完整起始项目时就该省略;第三个参数给排除规则(`opts.ignore`),用来把 `node_modules`、构建产物这类不该进沙箱的目录挡在外面:

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

`t.sandbox` 这一个命名空间下按语义分组:`writeFiles` / `uploadFiles` / `runCommand` 是立即 IO / 命令;`fileChanged` / `fileDeleted` / `notInDiff` / `diff` / `file` 是结果视图和延迟断言。`stop()` 这类生命周期动作不暴露给 eval 作者,由 runner 管。要用 judge 评 sandbox 产物,直接 `t.judge.autoevals.closedQA(criteria, { on: t.sandbox.diff.get(path) })`。操作列表见 [Sandbox · 文件与命令](../sandbox/library/operations.md),评分写法见 [Sandbox · 断言结果](../sandbox/library/asserting-results.md)。结果视图读的是 **agent 归因增量**——runner 的变更分类账把每次 `t.send()` 窗口内的 workspace 变化归给 agent:你写入的起始 fixture、`t.send()` 之后手工写入的隐藏校验文件都不会出现在 `t.sandbox.diff` 里,`fileChanged` 断的是「agent 改了它」,不是「它相对空目录变了」;第一次 `t.send()` 之前 diff 恒为空、可读不报错。归因契约见 [Sandbox · 变更归因](../sandbox/architecture.md#变更归因send-窗口与分类账)。

## setup 与 teardown:任务夹具的起与收

`EvalDef.setup(sandbox, ctx)` / `teardown(sandbox, ctx)` 是这条 eval 的任务夹具钩子对,每 attempt 一次。时序:`setup` 在环境层钩子与变更分类账锚点之后、`agent.setup` 与 `test(t)` 之前;`teardown` 是 attempt 收尾链的第一段(`eval.teardown` → `agent.teardown` → `sandbox.teardown`),此刻沙箱还活着,收尾代码可以照常读沙箱。触发规则与四层统一的成对语义(`setup` 时点走到过才触发、`setup` / `test` 抛错都不豁免)见 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它)。

大多数夹具不需要 `teardown`:写进沙箱的起始文件、装的依赖随沙箱销毁自动没了。需要 `teardown` 的是**沙箱外**的夹具——在共享外部服务里为本 attempt 建的临时资源(临时 repo、bucket、队列 topic),不收就泄漏。

状态纪律:同一条 eval 的多个 attempt(`runs` 大于 1、或同批多个实验跑同一条 eval)并发执行且共享本模块,`setup` 的句柄不能放普通模块变量(会互相覆写);以 `sandbox` 实例作键——sandbox 与 attempt 一一对应,是天然的 per-attempt 键:

```typescript
// evals/pr-review/close-stale.eval.ts
import { defineEval } from "niceeval";
import type { Sandbox } from "niceeval/sandbox";

// 并发 attempt 共享本模块:句柄按 sandbox 键控,不用普通模块变量
const fixtures = new WeakMap<Sandbox, { repoUrl: string; destroy(): Promise<void> }>();

export default defineEval({
  async setup(sandbox, ctx) {
    ctx.progress({ message: "seeding fixture repo" });
    const fixture = await createFixtureRepo("pr-review/close-stale");   // 沙箱外的临时资源
    fixtures.set(sandbox, fixture);
    await sandbox.runCommand("git", ["clone", fixture.repoUrl, "workspace"]);
  },
  async teardown(sandbox) {
    await fixtures.get(sandbox)?.destroy();   // setup 抛错也会进来:没建成就跳过
  },
  async test(t) { /* 驱动 agent 清理 stale PR,断言 */ },
});
```

`teardown` 抛错或超过 30s 清理上限只记 `teardown-failed` 诊断、不改这个 attempt 已产出的判定;要让某个收尾动作影响结论,在 `setup` / `test` 里抛,不在 `teardown` 里。

## 命名与组织约定

- 文件名以 `.eval.ts` 或 `.eval.tsx` 结尾才会被发现(要在 eval 里写 JSX 时用 `.tsx`,两者的发现规则与 id 推导完全相同)。
- 目录只形成 id 前缀:`evals/billing/refund.eval.ts` → `billing/refund`；运行选择仍由 experiment 的 `evals` 决定。
- 数据集放 `evals/data/`,沙箱型 eval 要写入的起始文件素材可以放 `evals/fixtures/`(纯目录命名约定,运行器不会扫描或自动加载它——仍要在 `test()` 里手工 `t.sandbox.writeFiles`/`uploadFiles` 读取写入)。
- `description` 写给人看,id 给机器引用。

## 相关阅读

- [README](README.md) —— `defineEval` 的核心契约。
- [Eval Context](library/context.md) —— `t`、`session`、`turn` 的调用和结果字段。
- [Architecture](architecture.md) —— 作用域断言的设计依据。
- [Scoring](../scoring/README.md) —— 断言、judge、严重度与判定。
