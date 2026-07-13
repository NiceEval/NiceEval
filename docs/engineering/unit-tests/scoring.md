# Scoring 与断言的单元测试

契约来源：[Scoring](../../feature/scoring/README.md)、[值断言](../../feature/scoring/library/value-assertions.md)、[Scope](../../feature/scoring/architecture/scopes.md)、[证据完整性](../../feature/scoring/architecture/evidence.md) 和 [Severity/Verdict](../../feature/scoring/architecture/severity-and-verdict.md)。

## Matcher：直接测试评分语义

Matcher 是纯评分规则，断言 score、severity、threshold 和稳定名称：

```ts
import { describe, expect, it } from "vitest"
import { includes, similarity } from "../../expect/index.ts"

describe("includes", () => {
  it.each([
    { value: "Brooklyn weather", expected: 1 },
    { value: "Queens weather", expected: 0 },
    { value: 42, expected: 0 },
  ])("对 $value 的得分是 $expected", async ({ value, expected }) => {
    const matcher = includes("Brooklyn")
    expect(await matcher.score(value)).toBe(expected)
    expect(matcher.severity).toBe("gate")
  })
})

it("similarity 的 score 始终位于 0..1", async () => {
  const matcher = similarity("expected")
  for (const value of ["", "expected", "different", "🙂"] as const) {
    const score = await matcher.score(value)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  }
})
```

不要测试 JavaScript `String.includes` 本身；输入矩阵应覆盖 niceeval 增加的转换、默认严重度、正则或注释处理语义。

## Collector fixture

Collector 的 fixture 提供最小完整 `ScoringContext`，每个字段默认采用“明确空”而不是 `undefined`：

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

当测试“证据未知”时必须显式构造 unknown/incomplete 状态，不能复用上面的明确空 fixture。

## 示例：链式句柄只改变分级，不重复求值

```ts
import { expect, it, vi } from "vitest"
import { AssertionCollector } from "../../scoring/collector.ts"

it("atLeast 把 assertion 变为 soft threshold，evaluate 只运行一次", async () => {
  const evaluate = vi.fn(() => 0.7)
  const collector = new AssertionCollector()

  collector.record({ name: "quality", severity: "gate", evaluate }).atLeast(0.8)
  const [result] = await collector.finalize(scoringContext())

  expect(result).toMatchObject({
    name: "quality",
    severity: "soft",
    threshold: 0.8,
    score: 0.7,
    passed: false,
  })
  expect(evaluate).toHaveBeenCalledOnce()
})
```

这里检查调用次数是有意义的，因为“延迟断言只求值一次”是生命周期契约；一般 helper 调用次数不是。

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

it("receiver 决定 scope", async () => {
  const { t, sessions } = contextFromEvidence(evidence)

  sessions.main.turns[0].calledTool("search")
  sessions.main.calledTool("shell")
  t.calledTool("shell")

  const results = await finalizeAssertions(t)
  expect(results.map((result) => result.passed)).toEqual([true, false, true])
})
```

这个场景故意让三个 scope 得到不同答案，才能发现 selector 被错误复用。三个 scope 都只含一个相同事件的 fixture 没有区分力。

## Verdict 决策表

优先级与 strict 适合表驱动，直接断言最终 Verdict：

```ts
import { expect, it } from "vitest"
import { computeVerdict } from "../../scoring/verdict.ts"
import type { AssertionResult } from "../../types.ts"

const failedGate: AssertionResult = {
  name: "gate",
  severity: "gate",
  score: 0,
  passed: false,
}
const failedSoft: AssertionResult = {
  name: "quality",
  severity: "soft",
  threshold: 0.8,
  score: 0.7,
  passed: false,
}

it.each([
  { input: { error: "timeout", assertions: [failedGate], skipReason: "later" }, expected: "errored" },
  { input: { assertions: [failedGate], skipReason: "later" }, expected: "failed" },
  { input: { assertions: [], skipReason: "not applicable" }, expected: "skipped" },
  { input: { assertions: [failedSoft], strict: false }, expected: "passed" },
  { input: { assertions: [failedSoft], strict: true }, expected: "failed" },
])("判定为 $expected", ({ input, expected }) => {
  expect(computeVerdict(input)).toBe(expected)
})
```

## 负断言与证据完整性

`notCalledTool`、`usedNoTools`、`maxTokens` 等不能只测完整空输入。至少形成三列：

| 证据 | `calledTool` | `notCalledTool` |
|---|---|---|
| 完整，且找到调用 | passed | failed |
| 完整，确认无调用 | failed | passed |
| 不完整，无法确认 | failed | 不得伪装成可信 passed |

Fixture 应让完整性成为显式字段；不能用 `events: []` 同时表示“确认没有”和“没采到”。

## 不这样测

- 不给每个 matcher 都重复测试 `.gate()`；链式分级在共享 collector 契约测试一次。
- 不断言 `computeVerdict` 内部先执行哪个 `if`，只断言冲突输入的最终优先级。
- 不用所有 scope 都会通过的事件 fixture。
- 不把 judge HTTP client 的 mock 返回值原样断言成 score；要验证请求材料、错误分类、缺 key 和 score 归一。
