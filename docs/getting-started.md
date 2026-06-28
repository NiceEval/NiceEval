# Getting Started

这一篇带你从零跑通三种 eval:一个进程内函数 eval、一个会话型 agent eval、一个沙箱里的 coding-agent eval。读完你就有了能在 CI 里跑的最小骨架。

> 注:fastevals 目前处于设计阶段,本篇描述的是目标用法(目标 DX),作为实现依据。

## 安装

```sh
npm install -D fastevals
npx fastevals init        # 生成 evals/、fastevals.config.ts、示例 eval
```

`init` 后的目录:

```
your-project/
├─ fastevals.config.ts
└─ evals/
   ├─ hello.eval.ts            # 示例:会话型
   └─ fixtures/
      └─ button/               # 示例:沙箱型
         ├─ PROMPT.md
         ├─ EVAL.ts
         └─ package.json
```

## 配置

```typescript
// fastevals.config.ts
import { defineConfig } from "fastevals";
import { Console, JUnit } from "fastevals/reporters";

export default defineConfig({
  judge: { model: "anthropic/claude-haiku-4-5" }, // 默认评判模型
  reporters: [Console(), JUnit(".fastevals/junit.xml")],
  maxConcurrency: 8,
  timeoutMs: 300_000,
  sandbox: "auto",                                 // 有云 token 用云,否则 docker
});
```

## 1. 评一个进程内函数(最快)

适合把你自己的 agent / 函数当成"语义级单测"跑在 CI 里,零网络。先写一个进程内 agent(`send` 直接调你的代码),在配置里注册,再让 eval 按名字引用它:

```typescript
// agents/classify.ts —— 进程内 agent
import { defineAgent } from "fastevals";
import { classifyIntent } from "../src/agent.js";   // 你自己的代码

export default defineAgent({
  name: "classify",
  async send(input) {
    return { data: await classifyIntent(input.text), status: "completed" };
  },
});
```

```typescript
// evals/classify.eval.ts
import { defineEval } from "fastevals";
import { equals } from "fastevals/expect";

export default defineEval({
  description: "意图分类:退款",
  agent: "classify",                            // 引用上面注册的 agent
  async test(t) {
    const turn = await t.send("我想退货退款");
    t.check(turn.data, equals({ intent: "refund" }));
  },
});
```

(把 `classify` 加进 `fastevals.config.ts` 的 `agents: [...]`,或设成 `defaultAgent`。)

```sh
npx fastevals classify
```

## 2. 评一个会话型 agent(本地或远程)

驱动一个暴露会话接口的 agent,断言它的回复与工具调用。连你的服务也是写一个 agent —— 它内部按你服务的协议发请求,URL 是它读 env 的私事(fastevals 不定义 agent 协议,所以没有 `--url`):

```typescript
// agents/weather-bot.ts —— 远程 agent,URL 是它的私事
import { defineAgent } from "fastevals";

export default defineAgent({
  name: "weather-bot",
  capabilities: { conversation: true, toolObservability: true },
  async send(input, ctx) {
    const r = await fetch(`${process.env.AGENT_URL}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: input.text }),
      signal: ctx.signal,
    });
    const body = await r.json();
    return { message: body.reply, toolCalls: body.tools, status: "completed" };
  },
});
```

```typescript
// evals/weather/brooklyn.eval.ts
import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

export default defineEval({
  description: "布鲁克林天气",
  agent: "weather-bot",
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");
    t.succeeded();
    t.calledTool("get_weather", { input: { city: "Brooklyn" } });
    t.check(t.reply, includes("晴"));
    t.judge.closedQA("回答是否礼貌且切题").atLeast(0.7);
  },
});
```

```sh
AGENT_URL=https://my-agent.example.com npx fastevals weather --agent weather-bot
```

## 3. 评一个塞进沙箱的 coding agent

给一个编码任务,让 Claude Code / bub 在隔离环境里改代码,再用测试验证。

**Fixture 三件套:**

```markdown
<!-- evals/fixtures/button/PROMPT.md -->
用项目现有的样式系统,在 src/components/Button.tsx 导出一个 Button 组件,
接受 label 和 onClick 两个 prop,并实现 hover 态。
```

```typescript
// evals/fixtures/button/EVAL.ts —— 验证测试,agent 看不到
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

test("Button 存在", () => {
  expect(existsSync("src/components/Button.tsx")).toBe(true);
});

test("接受 label / onClick", () => {
  const src = readFileSync("src/components/Button.tsx", "utf-8");
  expect(src).toContain("label");
  expect(src).toContain("onClick");
});

// 也能断言 agent 的「行为」,而不只是结果:
test("没有暴力删库", () => {
  const o11y = JSON.parse(readFileSync("__fastevals__/results.json", "utf-8")).o11y;
  expect(o11y.shellCommands.map((c) => c.command)).not.toContain("rm -rf");
});
```

```json
{
  "name": "button-fixture",
  "type": "module",
  "scripts": { "build": "tsc --noEmit" },
  "devDependencies": { "vitest": "^2.0.0" }
}
```

**跑起来:**

```sh
# 直连 API + 本地 Docker,不需要任何云 token
export ANTHROPIC_API_KEY=sk-ant-...
npx fastevals --agent claude-code --sandbox docker fixtures/button

# 跑 10 次取通过率,先过一次就早停
npx fastevals --agent claude-code --runs 10 --early-exit fixtures/button
```

## 看结果

控制台实时出行:

```text
Discovered 3 evals

  ✓ classify (12ms)
  ✓ weather/brooklyn (456ms)
  ✗ fixtures/button (38s)
    - gate: EVAL.ts › 接受 label / onClick [FAILED]
      Expected src to contain "onClick"

Results:  2 passed, 1 failed, 0 scored, 0 skipped
```

详细工件落在 `.fastevals/<时间戳>/`:`summary.json`、逐 eval 结果、事件流、transcript、生成文件 diff、测试输出。结构详见 [Observability](observability.md)。

## 接进 CI

```yaml
# .github/workflows/evals.yml
- run: npx fastevals --strict --junit .fastevals/junit.xml
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

`--strict` 让 soft 断言低于阈值也判红;有任何 `failed` 即非零退出。

## 接着读

- [Authoring](authoring.md) —— 多轮、数据集扇出、fixture 进阶。
- [Scoring](scoring.md) —— 全部评分手段。
- [CLI](cli.md) —— 全部命令与标志。
