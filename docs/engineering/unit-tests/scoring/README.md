# Scoring 与断言的测试架构

契约来源：[Scoring](../../../feature/scoring/README.md)、[值断言](../../../feature/scoring/library/value-assertions.md)、[作用域断言](../../../feature/scoring/library/scoped-assertions.md)、[Judge](../../../feature/scoring/library/judge.md)、[Scope](../../../feature/scoring/architecture/scopes.md)、[证据完整性](../../../feature/scoring/architecture/evidence.md)、[Severity/Verdict](../../../feature/scoring/architecture/severity-and-verdict.md) 与 [Scoring CLI](../../../feature/scoring/cli.md)。判定层给出"看似合理但错误的答案"的代价最高，是全套件预算最重的领域（裁决出处见 memory 的 [test-budget-inverted-pyramid](../../../../memory/test-budget-inverted-pyramid.md)）。用例登记在 [cases.md](cases.md)。

## 观察面与边界

| 契约域 | 观察面 | 边界 |
|---|---|---|
| matcher 评分语义 | `score(value)` 的返回值与默认 severity | 领域规则，直接测 matcher |
| collector 生命周期 | `finalize()` 产出的 AssertionResult 数组 | 组件协作 |
| scope 数据范围 | 同一证据图下三个接收者的判定差异 | 组件协作 |
| 证据完整性 | 负断言/上限断言在三种完整性状态下的结果 | 领域规则 + 组件协作 |
| Verdict 优先级 | `computeVerdict` 决策表 | 领域规则 |
| judge | 发往裁判模型的请求材料、错误分类、缺 key 行为 | 边界归一（fixture judge client） |

## Collector fixture

Collector 的 fixture 提供最小完整 `ScoringContext`，每个字段默认采用"明确空"而不是 `undefined`：

```ts
import type { ScoringContext } from "../../types.ts"

function scoringContext(
  overrides: Partial<ScoringContext> = {},
): ScoringContext {
  return {
    events: [],
    facts: {
      toolCalls: [],
      subagentCalls: [],
      inputRequests: [],
      parked: false,
      messageCount: 0,
      compactions: 0,
    },
    diff: { files: [] },
    scripts: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed",
    async readFile() { return undefined },
    ...overrides,
  }
}
```

当测试"证据未知"时必须显式构造 unknown/incomplete 状态，不能复用上面的明确空 fixture——`events: []` 不允许同时表示"确认没有"和"没采到"（规则见 [Harness](../harness.md)）。

## Scope fixture：一份证据图测试三个接收者

```ts
const evidence = attemptEvidenceFixture({
  sessions: [
    {
      id: "main",
      turns: [
        { events: [toolCalled("search", "c1")] },
        { events: [assistantMessage("done")] },
      ],
    },
    {
      id: "other",
      turns: [{ events: [toolCalled("shell", "c2")] }],
    },
  ],
})
```

场景必须让三个 scope 得到不同答案，才能发现 selector 被错误复用。三个 scope 都只含一个相同事件的 fixture 没有区分力。
