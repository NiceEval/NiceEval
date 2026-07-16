# Getting Started

这一篇带你从零跑通三种 eval:一个会话型 agent eval(走 HTTP)、一个纯函数的语义级单测、一个沙箱里的 coding-agent eval。读完你就有了能在 CI 里跑的最小骨架。

> 注:本篇描述推荐 DX 和目标用法。若代码实现与这里的设计不一致,应进一步讨论并决定是修代码、修设计,还是记录为明确的阶段性差异。

## 安装

```sh
npm install -D niceeval
npx niceeval init        # 生成 evals/、niceeval.config.ts、示例 eval
```

`init` 后的目录:

```
your-project/
├─ niceeval.config.ts
└─ evals/
   ├─ hello.eval.ts            # 示例:会话型
   └─ fixtures/
      └─ button.eval.ts        # 示例:沙箱型,起始文件在 test() 里手工写入
```

## 配置

```typescript
// niceeval.config.ts
import { defineConfig } from "niceeval";
import { JUnit } from "niceeval/reporters";

export default defineConfig({
  judge: { model: "anthropic/claude-haiku-4-5" }, // 默认裁判模型
  reporters: [JUnit(".niceeval/junit.xml")], // 终端反馈由 `niceeval exp --output human|agent|ci` 选择,不是 Reporter
  maxConcurrency: 8,
  timeoutMs: 300_000,
  // 沙箱 provider 不在这里配 —— 它由 experiment 的 sandbox 字段决定
});
```

## 1. 评一个会话型 agent

驱动一个暴露会话接口的 agent,断言它的回复与工具调用。连你的服务也是写一个 agent —— 它内部按你服务的协议发请求,URL 是它读 env 的私事(niceeval 不定义 agent 协议,所以没有 `--url`)。就算 agent 和 eval 在同一个代码库里,也照样让 adapter 走 HTTP,不要把 `fetch` 换成进程内的函数直调——直调绕过了用户实际走的链路、进程不隔离导致结果不可复现,取舍详见[接入你的 Agent · 为什么不直调](../docs-site/zh/how-to/connect-your-agent.mdx):

```typescript
// agents/weather-bot.ts —— 远程 agent,URL 是它的私事
import { defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "weather-bot",
  async send(input, ctx) {
    const r = await fetch(`${process.env.AGENT_URL}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: input.text }),
      signal: ctx.signal,
    });
    const body = await r.json();
    // 用 calledTool / messageIncludes 等断言时,必须把响应映射成标准事件流
    return { events: toStreamEvents(body), data: body.output, status: "completed" };
  },
});
```

```typescript
// evals/weather/brooklyn.eval.ts
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "布鲁克林天气",
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");
    t.succeeded();
    t.calledTool("get_weather", { input: { city: "Brooklyn" } });
    t.check(t.reply, includes("晴"));
    t.judge.autoevals.closedQA("回答是否礼貌且切题").atLeast(0.7);
  },
});
```

```sh
AGENT_URL=https://my-agent.example.com npx niceeval exp local weather
```

## 2. 评一个纯函数(边缘场景:语义级单测,不测生产链路)

只有当你确实只想把一个纯函数当"语义级单测"跑、并且清楚这测的不是用户实际走的链路时,才让 `send` 直接调用进程内代码——生产路径的评测请用上一节的 HTTP 写法:

```typescript
// agents/classify.ts —— 进程内直调,仅用于纯函数单测场景
import { defineAgent } from "niceeval/adapter";
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
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "意图分类:退款",
  async test(t) {
    const turn = await t.send("我想退货退款");
    t.check(turn.data, equals({ intent: "refund" }));
  },
});
```

(把 `classify` agent 放进一个 `experiments/local.ts` 运行配置。)

```sh
npx niceeval exp local classify
```

## 3. 评一个塞进沙箱的 coding agent

给一个编码任务,让 Claude Code / bub 在隔离环境里改代码,再用测试验证。起始文件、验证测试都是 `test(t)` 里手工放进沙箱——没有 `PROMPT.md` 目录约定,也没有自动发现:

```typescript
// evals/fixtures/button.eval.ts
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const PACKAGE_JSON = JSON.stringify({
  name: "button-fixture",
  type: "module",
  scripts: { build: "tsc --noEmit", test: "vitest run" },
  devDependencies: { vitest: "^2.0.0" },
});

// 验证测试的源码,agent 跑完之后才会被放进沙箱,它全程看不到
const BUTTON_TEST = `
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
  const o11y = JSON.parse(readFileSync("__niceeval__/results.json", "utf-8")).o11y;
  expect(o11y.shellCommands.map((c) => c.command)).not.toContain("rm -rf");
});
`;

export default defineEval({
  description: "实现一个 Button 组件",
  async test(t) {
    await t.sandbox.writeFiles({ "package.json": PACKAGE_JSON });

    await t.send(
      "用项目现有的样式系统,在 src/components/Button.tsx 导出一个 Button 组件,接受 label 和 onClick 两个 prop,并实现 hover 态。",
    );

    // agent 那一轮已经结束,现在才放测试文件、才跑测试
    await t.sandbox.writeFiles({ "button.test.ts": BUTTON_TEST });
    const test = await t.sandbox.runCommand("npm", ["test"]);
    t.check(test, commandSucceeded());
  },
});
```

`experiments/local.ts` 里给这个沙箱型 agent 加一个 `sandbox: dockerSandbox()`(从 `niceeval/sandbox` 导入)——沙箱 provider 没有默认值,也没有 `--sandbox` 这种 CLI 覆盖,必须写进 experiment(或 `niceeval.config.ts` 兜底)。

**跑起来:**

```sh
# 直连 API + 本地 Docker,不需要任何云 token
export ANTHROPIC_API_KEY=sk-ant-...
npx niceeval exp local fixtures/button

# 跑 10 次取通过率,先过一次就首过即停
npx niceeval exp local fixtures/button --runs 10 --early-exit
```

## 看结果

控制台实时输出:

```text
Discovered 3 evals

  ✓ classify (12ms)
  ✓ weather/brooklyn (456ms)
  ✗ fixtures/button (38s)
    - gate: commandSucceeded [FAILED]
      button.test.ts › 接受 label / onClick
      Expected src to contain "onClick"

Results:  2 passed, 1 failed, 0 skipped
```

详细 artifact 落在该实验的快照目录 `.niceeval/<experiment>/<snapshot>/`:快照级 `snapshot.json`,以及每个 attempt 目录下的 `result.json`(判决、断言、结构化错误与 diagnostics)与按需生成的 `events.json`、`sources.json`、`trace.json`、`o11y.json`、`diff.json`。结构详见 [Results Format](feature/results/architecture.md)。

## 接进 CI

```yaml
# .github/workflows/evals.yml
- run: npx niceeval exp ci --strict --junit .niceeval/junit.xml
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

`--strict` 让 soft 断言低于阈值也判为 `failed`;有任何 `failed` 或 `errored` 即非零退出。

## 接着读

- [Authoring](feature/eval/README.md) —— 多轮、数据集扇出、fixture 进阶。
- [Scoring](feature/scoring/README.md) —— 全部评分手段。
- [CLI 参考](../docs-site/zh/reference/cli.mdx) —— 全部命令与标志。
