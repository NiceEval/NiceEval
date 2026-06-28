# Authoring —— 编写 eval

这一篇是写 eval 的手册:单轮、多轮、数据集扇出,以及沙箱型 fixture 的写法。评分手段单独成篇,见 [Scoring](scoring.md)。

核心 DX 原则(继承自 eve):**路径即身份、一文件一 eval、线性书写就地断言**。理由见 [Vision](vision.md)。

## `defineEval` 的形状

```typescript
import { defineEval } from "fastevals";

export default defineEval({
  description?: string;            // 人读的描述,出现在报告里
  agent?: string;                  // 连哪个 agent(按名字);省略则用配置 defaultAgent 或 --agent
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
import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

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
import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

export default defineEval({
  description: "先拟稿,确认后再发送",
  async test(t) {
    const draft = await t.send("帮我拟一封跟进邮件。");
    draft.expectOk();                          // 上一轮若失败,这里抛
    t.check(draft.message, includes("此致"));
    t.judge.closedQA("语气是否专业", { on: draft.message }).atLeast(0.6);

    await t.send("好,发出去。");
    t.calledTool("send_email");
  },
});
```

需要并行的独立会话时用 `t.newSession()` 开一条互不干扰的对话线。

## 数据集扇出

一个文件默认导出**一个数组**,就扇出成多个 eval。这是写数据集的规范方式:

```typescript
// evals/sql.eval.ts
import { defineEval } from "fastevals";
import { loadYaml } from "fastevals/loaders";
import { equals } from "fastevals/expect";

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

## 选择 Agent

`agent` 按名字选一条连到 AI 的连接,它的能力决定 `t` 能干什么。agent 由你自己写(`defineAgent` / `defineSandboxAgent`)并在配置里注册,eval 里只用名字引用:

```typescript
export default defineEval({
  description: "...",
  agent: "my-agent",        // 引用一个进程内 / 远程 agent
  async test(t) { /* ... */ },
});

// 沙箱里的 coding agent(通常配合 defineAgentEval / fixture,见下)
export default defineEval({
  agent: "claude-code",     // 内置沙箱 agent,跑在哪由 --sandbox 决定
  async test(t) { /* ... */ },
});
```

省略 `agent` 时,用配置的 `defaultAgent` 或 CLI 的 `--agent` 提供的连接 —— 这让同一份 eval 能换着被测对象跑(本地 vs 部署、agent A vs agent B)。怎么写一个 agent,详见 [Agents 与 Adapters](agents-and-adapters.md)。

## 沙箱型:Fixture

评一个 coding agent 时,Task 不写在代码里,而是一个磁盘目录(fixture)。约定:

```
evals/fixtures/create-button/
├─ PROMPT.md          # 给 agent 的任务(必需)
├─ EVAL.ts            # 验证测试,Vitest 风格(必需;或 EVAL.tsx)
├─ package.json       # 必须 "type": "module"
├─ src/               # 起始代码(可选)
└─ tsconfig.json
```

- **PROMPT.md** 是发给 agent 的提示词。
- **EVAL.ts** 是评分逻辑,**对 agent 不可见**(只在验证阶段才上传到沙箱),防止它看答案作弊。
- 其余文件是 agent 可见的 workspace。

Fixture 靠"目录里有 PROMPT.md"被自动发现,支持任意嵌套(`fixtures/api/auth/`)。无需为它写任何 `.eval.ts`。

### 在 EVAL.ts 里断言「行为」

除了断言结果文件,你还能断言 agent 干过什么 —— o11y 摘要被注入沙箱:

```typescript
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";

test("用脚手架命令初始化,而不是手搓", () => {
  const o11y = JSON.parse(readFileSync("__fastevals__/results.json", "utf-8")).o11y;
  const cmds = o11y.shellCommands.map((c: { command: string }) => c.command);
  expect(cmds.some((c) => c.includes("create-next-app"))).toBe(true);
});
```

可读字段见 [Observability](observability.md#o11y-summary)。

### 程序化定义(可选)

不想用磁盘约定时,可显式定义并复用一套断言:

```typescript
// evals/refactor.eval.ts
import { defineAgentEval } from "fastevals";

export default defineAgentEval({
  description: "把回调改写成 async/await",
  prompt: "把 src/legacy.js 里的回调全部改写成 async/await,保持行为不变。",
  files: "./fixtures/legacy-callbacks",     // workspace 起始文件
  async test(t) {
    await t.run();                          // 驱动 agent
    t.fileChanged("src/legacy.js");
    t.check(t.diff.get("src/legacy.js"), includes("await"));
    await t.script("test");                 // 跑 npm run test
    t.testsPassed();
  },
});
```

`defineAgentEval` 和 fixture 是同一件事的两种写法:fixture 适合大批量、跨语言;`defineAgentEval` 适合要精细控制流程或复用断言。两者共享同一套评分 / 运行 / 报告。

## 命名与组织约定

- 文件名以 `.eval.ts` 结尾才会被发现。
- 用目录表达分组:`evals/billing/refund.eval.ts` → `billing/refund`。
- 数据集放 `evals/data/`,fixture 放 `evals/fixtures/`(约定,非强制)。
- `description` 写给人看,id 给机器引用。

## 相关阅读

- [Scoring](scoring.md) —— `t.check` / 作用域断言 / judge / 测试 的完整能力。
- [Agents 与 Adapters](agents-and-adapters.md) —— agent 三类 transport 与 agent 适配。
- [CLI](cli.md) —— 过滤、重试、并发等运行标志。
