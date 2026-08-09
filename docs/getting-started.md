# Getting Started

这一篇带你从零跑通三种 eval:一个会话型 agent eval(走 HTTP)、一个纯函数的语义级单测、一个沙箱里的 coding-agent eval。读完你就有了能在 CI 里跑的最小骨架。

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
  reporters: [JUnit(".niceeval/junit.xml")], // 终端反馈是人读文本,加 `--json` 换机器事件流;都不是 Reporter
  maxConcurrency: 8,
  timeoutMs: 300_000,
  // 沙箱起点不在这里配 —— 由 Experiment 或 Eval 的 sandbox 字段声明,factory 带出 Provider
});
```

## 1. 评一个会话型 agent

驱动一个暴露会话接口的 agent,断言它的回复与工具调用。连你的服务也是写一个 agent —— 它内部按你服务的协议发请求,URL 是它读 env 的私事(NiceEval 不定义 agent 协议,所以没有 `--url`)。就算 agent 和 eval 在同一个代码库里,也照样让 adapter 走 HTTP,不要把 `fetch` 换成进程内的函数直调——直调绕过了用户实际走的链路、进程不隔离导致结果不可复现,取舍详见[接入你的 Agent · 为什么不直调](../docs-site/zh/tutorials/connect-your-agent.mdx):

```typescript
// agents/weather-bot.ts —— 远程 agent,URL 是它的私事
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "weather-bot",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const r = await fetch(`${process.env.AGENT_URL}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: input.text }),
      signal: ctx.signal,
    });
    const body = await r.json();
    // 用 calledTool / messageIncludes 等断言时,必须把响应映射成标准事件流
    return { events: toStreamEvents(body), data: body.output, status: toTurnStatus(body) };
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
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { classifyIntent } from "../src/agent.js";   // 你自己的代码

export default defineAgent({
  name: "classify",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input) {
    return { data: await classifyIntent(input.text), events: [], status: "completed" };
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

## 3. 评一个放入沙箱的 coding agent

给一个编码任务,让 Claude Code / bub 在隔离 Sandbox 里改代码,再用测试验证。起始文件、验证测试都是 `test(t)` 里手工放进沙箱——没有 `PROMPT.md` 目录约定,也没有自动发现:

```typescript
// evals/fixtures/button.eval.ts
import { defineEval } from "niceeval";
import { commandSucceeded, excludes } from "niceeval/expect";

const PACKAGE_JSON = JSON.stringify({
  name: "button-fixture",
  type: "module",
  scripts: { test: "vitest run" },
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
`;

export default defineEval({
  description: "实现一个 Button 组件",
  async test(t) {
    // fixture 与依赖在 agent 上场前就位,npm test 不依赖 agent 自己想起来装依赖
    await t.sandbox.writeText("package.json", JSON.stringify(PACKAGE_JSON));
    const install = await t.sandbox.runCommand("npm", ["install"]);
    t.require(install, commandSucceeded());

    await t.send(
      "在 src/components/Button.tsx 导出一个 Button 组件,接受 label 和 onClick 两个 prop。",
    );

    // agent 那一轮已经结束,现在才放测试文件、才跑测试
    await t.sandbox.writeText("button.test.ts", BUTTON_TEST);
    const test = await t.sandbox.runCommand("npm", ["test"]);
    t.check(test, commandSucceeded());

    // 行为断言在宿主侧:agent 与沙箱都感知不到
    t.check(t.o11y.shellCommands.map((c) => c.command).join("\n"), excludes("rm -rf"));
  },
});
```

`experiments/local.ts` 里给这个沙箱型 agent 加一个 `sandbox: dockerImageSandbox({ image: NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE })`(都从 `niceeval/sandbox` 导入)。
没有游离的 Provider 配置,也没有 `--sandbox` 这种 CLI 替换:起点由 template-bearing factory 声明并同时带出 Provider,写在 Experiment 或 Eval 的 `sandbox` 字段上(配对规则见 [Sandbox Layer](feature/sandbox/layers.md))。

**跑起来:**

```sh
# 直连 API + 本地 Docker,不需要任何云 token
export ANTHROPIC_API_KEY=sk-ant-...
npx niceeval exp local fixtures/button

# 跑 10 次测通过率(默认跑满,不提前退出)
npx niceeval exp local fixtures/button --attempts 10

# 只想知道能不能过、不在乎通过率:过一次就停,省下剩余次数
npx niceeval exp local fixtures/button --attempts 10 --early-exit
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

每次运行的结构化执行错误、diagnostic、事件、源码与 raw trace / usage 随 origin Run 以 Observation 追加进 `.niceeval` RecordStore；断言、Judge、Verdict 与估算成本是带依据的 Claim。diff、timing、trace 与 usage 的读面由固定 GraphRef 上的 Projector 重建，不存在按最近结果或私有 snapshot 文件选择事实的路径。
结构详见 [Record Format](feature/record/architecture.md)。

## 接进 CI

```yaml
# .github/workflows/evals.yml
- run: npx niceeval exp ci --strict --junit .niceeval/junit.xml
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

`--strict` 让 soft 断言低于阈值也判为 `failed`;有任何 `failed` 或 `errored` 即非零退出。

## 接着读

- [Authoring](feature/eval/README.md) —— 多轮、测试集从输入数组生成多条 eval、fixture 进阶。
- [Assertions](./feature/assertions/README.md) —— 全部评分手段。
- [CLI 参考](../docs-site/zh/reference/cli.mdx) —— 全部命令与标志。
