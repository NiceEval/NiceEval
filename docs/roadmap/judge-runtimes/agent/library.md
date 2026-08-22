# Agent-as-Judge —— Library

Agent Judge 与 LLM Judge 接收同一个 [Judge Check](../material/library.md#recipe-与-check)。调用处只增加独立 Agent 的执行能力：

```ts
const check = judge.check({
  recipe: repositoryReview,
  material: {
    task: turn.material.input,
    reply: turn.material.reply,
  },
});

const review = t.judge.agent(check, {
  agent: reviewer,
  workspace: { snapshot: "attempt-workdir" },
  tools: ["read-file", "search", "run-command"],
  network: "none",
});

review.atLeast(0.8).label("修复质量");
```

## Runtime options

以下形状是穷尽的：

```ts
type ManagedJudgeTool = "read-file" | "search" | "run-command";

interface AgentJudgeOptions {
  readonly agent: Agent;
  readonly workspace?: {
    readonly snapshot: "attempt-workdir";
    readonly maxFiles?: number;
    readonly maxBytes?: number;
  };
  readonly tools: readonly ManagedJudgeTool[];
  readonly network?:
    | "none"
    | { readonly allow: readonly URLPattern[] };
  readonly timeoutMs?: number;
  readonly maxInvestigationBytes?: number;
}
```

`workspace` 省略时不创建或挂载被测 workdir；Direct Agent Judge 必须省略它。Sandbox Agent Judge 的 snapshot 是独立 copy，不能写回被测 Sandbox。`tools` 只能列出 Adapter 能完整 capture input/output 的受管能力；`network` 省略时是 `"none"`。Adapter 自身连接模型 provider 的 transport 不算调查网络授权。

Recipe rubric 可以用 anchors 描述 measurement 的可观察含义。Anchor 数值在 `[0,1]` 内严格递增，且都描述同一维度；它们只帮助 evaluator 校准，不是累计 score。

Pass Eval 中 measurement 使用 `.gate(n)` 才进入 failed。Score Eval 中可 `.score(n)`，并可额外 `.atLeast(n)`。threshold、score contribution 和 `.orStop()` 都是同一 AssertionHandle 的配置。
