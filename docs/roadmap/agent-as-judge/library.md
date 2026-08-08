# Agent-as-Judge —— Library

## 声明一条 Agent Judge 断言

`t.judge.agent()` 接收一份带评分参照点的 rubric，并返回与其它 Judge 相同的链式 Assertion。

```ts
interface AgentJudgeRubric {
  name: string;
  criterion: string;
  anchors: readonly AgentJudgeAnchor[];
}

interface AgentJudgeAnchor {
  score: number;
  description: string;
}

interface AgentJudgeOptions {
  on?: string;
  workspace?: "snapshot";
}
```

`name` 是 Assertion 标题；`criterion` 只描述要评价的一个质量维度。
`anchors` 至少包含 `score: 0` 与 `score: 1`，分数必须在 `[0, 1]` 内严格递增，描述同一维度在该分位的可观察表现。

```ts
t.judge.agent(
  {
    name: "回答完整性",
    criterion: "回答是否完整处理了用户提出的三个问题，并明确说明限制？",
    anchors: [
      { score: 0, description: "遗漏主要问题，或给出无法由材料支持的结论" },
      { score: 0.5, description: "处理主要问题，但遗漏一个次要限制" },
      { score: 1, description: "逐项处理三个问题，并准确说明全部限制" },
    ],
  },
  { on: turn.message },
).atLeast(0.8);
```

没有阈值时默认是只登记分数的 soft Assertion。
`.atLeast(x)`、`.gate(x?)`、`.soft()`、`.optional()`、`.points(n)` 与 `.stopOnFailure()` 完全复用既有 Assertion 语义。

## 默认材料与工作区

默认材料由接收者决定，与 LLM-as-Judge 一致：

| 接收者 | 默认材料 |
|---|---|
| `t.judge.agent()` | 主 Agent Session 的完整对话 |
| `session.judge.agent()` | 该 Agent Session 的完整对话 |
| `turn.judge.agent()` | 该 Turn 的 assistant message |

`{ on }` 用字符串显式替换默认材料。
材料进入裁判任务的 evidence 区，不与系统生成的 rubric、协议或安全指令拼成同一指令层。

`{ workspace: "snapshot" }` 请求最终 workdir 的隔离副本。
它只在被测 Attempt 与 Agent Judge 都是 Sandbox 形态时合法；其它组合在 Assertion 登记时抛配置错误，不把作者错误降级成 unavailable。
省略 `workspace` 时，Sandbox Agent Judge 仍有自己的工具 Sandbox，但其中不含被测工作区。

## 裁判执行配置

`JudgeConfig` 为 LLM Judge 与 Agent Judge 提供独立槽位：

```ts
interface JudgeConfig {
  llm?: LlmJudgeConfig;
  agent?: AgentJudgeConfig;
}

interface AgentJudgeConfig {
  agent: Agent;
  model?: string;
  reasoningEffort?: string;
  flags?: Readonly<Record<string, JsonValue>>;
  sandbox?: SandboxLayer;
  timeoutMs?: number;
}
```

`judge.llm` 的 profile、Provider 与材料协议由[原生 LLM Judge Runtime](../llm-judge-runtime/library.md)定义。
`judge.agent` 是一份原子配置，服务 `t.judge.agent()`；两种 Judge 可以在同一 Eval 中并存。

Agent Judge 配置按 Experiment → Eval → 项目配置选择最近一份完整声明，不逐字段合并。
单条 Assertion 不能临时替换 Agent 或 model，确保同一次裁判 A/B 能从 Experiment 文件重建。

```ts
export default defineExperiment({
  agent: supportBot,
  judge: {
    agent: {
      agent: directReviewer,
      model: "gpt-5.4",
      reasoningEffort: "high",
      timeoutMs: 5 * 60_000,
    },
  },
});
```

Direct Agent Judge 必须省略 `sandbox`。
Sandbox Agent Judge 必须提供恰好一个 template-bearing `sandbox`，其准备命令与 Provider 全部归裁判执行配置所有，不与被测 Eval 或 Experiment 的 Sandbox layer 合并。

```ts
export default defineExperiment({
  agent: codexAgent(),
  judge: {
    agent: {
      agent: codexAgent({ apiKeyEnv: "REVIEWER_OPENAI_KEY" }),
      model: "gpt-5.4",
      reasoningEffort: "high",
      sandbox: dockerImageSandbox({ image: "niceeval-agents:node24" }),
      timeoutMs: 15 * 60_000,
    },
  },
});
```

被测 Agent 与 Agent Judge 即使使用同一个 Adapter factory，也是两个独立实例。
作者必须为裁判显式声明凭据出处；NiceEval 不借用被测 Agent 的 key。

## 判分返回协议

Runner 把 rubric、材料清单、可用工作区和下面的 JSON Schema 作为固定裁判任务交给 Agent Judge。
Agent Judge 的最终结果必须满足这份穷尽形状：

```ts
interface AgentJudgeDecision {
  schema: "niceeval.agent-judge/1";
  score: number;
  rationale: string;
  evidence: readonly AgentJudgeEvidence[];
}

interface AgentJudgeEvidence {
  source: string;
  detail: string;
}
```

`score` 必须位于 `[0, 1]`。
`rationale` 解释分数怎样落在 rubric 参照点之间；`evidence` 指向材料片段、仓库路径与行号、命令及其结果，不能只重复判断。

Runner 优先读取 `Turn.data`。
`Turn.data` 省略时，最终 assistant message 必须只包含一个 JSON object，可以有一层 Markdown JSON code fence。
Runner 不从普通叙事中搜索或猜测对象边界。

第一次返回不合 schema 时，Runner 在同一 Agent Session 发送一次只包含校验错误的修正请求。
第二次仍不合法时，Assertion 记 `unavailable`，reason 为 `agent-judge-invalid-decision`。
这次修正是协议续接，不重新创建工作区，也不重新执行整条裁判任务。

## 错误与 unavailable

| reason | 条件 |
|---|---|
| `agent-judge-unresolved` | 执行到断言时没有可用的 `judge.agent` 配置 |
| `agent-judge-workspace-unavailable` | 无法捕获或导入声明的 workdir 快照 |
| `agent-judge-call-failed` | Agent setup、send、teardown 或底层 transport 无法形成可信结果 |
| `agent-judge-invalid-decision` | 一次修正后仍不能得到合法判分结果 |
| `agent-judge-timeout` | 整条裁判生命周期耗尽 `judge.agent.timeoutMs` |

以上原因都不产生 0 分。
它们进入既有 `unavailable` 数据；非 `.optional()` 使 Attempt `errored`，`.optional()` 只允许该证据缺席。
