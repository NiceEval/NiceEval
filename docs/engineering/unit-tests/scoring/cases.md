# Scoring 与断言的测试用例

本页是 Scoring 契约的场景登记表。fixture 形状见 [测试架构](README.md)。

## Matcher：内置值 matcher 评分语义

契约来源：[值断言](../../../feature/scoring/library/value-assertions.md)、[自定义断言](../../../feature/scoring/library/custom-assertions.md)。不测试 JavaScript `String.includes` 本身；输入矩阵覆盖 niceeval 增加的转换、默认严重度、正则或注释处理语义。

| 契约 | 场景 |
|---|---|
| `includes(needle)` 支持子串与正则命中，命中 1 未命中 0，默认 gate | 正例：子串；反例：未命中、非字符串值（42）；边界：正则 needle |
| `excludes(needle)` 与 includes 镜像：含 needle 得 0 | 正例：不含 → 1；反例：含 → 0 |
| `similarity(expected)` score 恒在 [0,1]，唯一默认 soft 的内置 matcher | 正例：相同 → 1；边界：空串、emoji、超长文本不越界 |
| `matches(schema)` 接受 Standard Schema / Zod，通过 1 失败 0，默认 gate | 正例：合法对象；反例：缺字段；边界：非 Zod 的 Standard Schema 实现 |
| `equals(expected)` 深度相等而非引用相等，默认 gate | 正例：结构相同不同引用；边界：NaN、undefined 字段、数组顺序 |
| `isTrue` / `isFalse` 严格布尔判断，truthy/falsy（1、""）不通过 | 反例：1、0、"true"；边界：null |
| `isDefined(label?)` 对 null/undefined 得 0，其它一切值（含 0、""、false）得 1 | 正例：0、空串通过；反例：null、undefined |
| `commandSucceeded()` 仅按退出码 0 判定 | 正例：exitCode 0；反例：exitCode 1 |
| `satisfies(predicate, label?)` 谓词映射 1/0，label 进 AssertionResult.name | 正例、反例；边界：谓词抛异常不得伪装成 passed |
| `makeAssertion` 的同步与异步 matcher 进入统一 Assertion 记录 | 正例：sync/async 各一；边界：score 抛异常归入错误 |

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

## 值断言入口：check / require / group

契约来源：[值断言](../../../feature/scoring/library/value-assertions.md)、[Scope](../../../feature/scoring/architecture/scopes.md)。

| 契约 | 场景 |
|---|---|
| `t.check(value, matcher)` 同步记录并继续执行，失败不中止收集 | 反例：第一条失败后第二条仍在结果中 |
| `await t.require(value, matcher)` 不通过时按 gate 中止后续代码；通过时返回原 value（引用不变） | 反例：require 失败后后续断言不被记录、Verdict 为 failed；正例：返回值 === 传入值；边界：失败不升级为 errored |
| `t.group(title, fn)` 只组织报告，不改变组内 score 与 severity，返回 fn 返回值，支持嵌套 | 正例：组内 gate 仍是 gate；边界：嵌套、async 返回值透传 |
| 值断言只评价显式传入的值，不隐式读取 scope 证据 | 边界：传入与事件流矛盾的值，结果只反映传入值 |

## Scope：接收者决定数据范围

契约来源：[Scope](../../../feature/scoring/architecture/scopes.md)、[作用域断言](../../../feature/scoring/library/scoped-assertions.md)。

| 契约 | 场景 |
|---|---|
| 同名断言挂 turn / session / t 时分别消费该轮、该 session 已有事件、全 attempt 聚合——同一证据图下三者可得不同 passed | 正例：事件只在 session B 时 turn(A)/session(A) failed、t passed；selector 不跨接收者复用 |
| `t.newSession()` 的事件进入 `t.*` 聚合，但不进入主 session 的 `t.reply` / `t.events` 即时视图 | 正例：副 session 工具调用使 t.calledTool 通过；反例：t.reply 不含副 session 消息 |
| session 级断言是时点快照，之后的新 turn 不追溯影响 | 边界：先断言再发生匹配调用 → 仍 failed |
| turn 级断言消费该轮不可变的事件、状态和 usage | 边界：turn 结束后新增事件不改变已记录结果 |
| `calledTool(name, { count })` 按匹配调用数判定 | 正例：恰好 2 次；反例：1 次 vs count:2 |
| `toolOrder(names)` / `eventOrder(types)` 按子序列（非连续、非全等）匹配 | 正例：中间夹其它调用仍通过；反例：顺序颠倒；边界：名字重复出现 |
| `succeeded()` 要求无失败且不停在未回答 HITL；`parked()` 要求干净停在输入请求——对同一证据互斥 | 正例：正常完成 → succeeded 过 parked 挂；反例：停在 inputRequest → 反转 |
| `noFailedActions()` 同时覆盖 failed 工具调用与 failed 子 Agent 动作 | 反例：仅 subagent 失败也要 failed |
| 接收者专属能力不下放：check/require/skip/log/group/newSession/sandbox 仅 t；outputEquals/outputMatches 仅 turn | 类型反例：session 上访问 check；正例：turn.outputMatches 评 turn.data |

```ts
it("receiver 决定 scope", async () => {
  const { t, sessions } = contextFromEvidence(evidence)

  sessions.main.turns[0].calledTool("search")
  sessions.main.calledTool("shell")
  t.calledTool("shell")

  const results = await finalizeAssertions(t)
  expect(results.map((result) => result.passed)).toEqual([true, false, true])
})
```

## Collector 生命周期

契约来源：[Scoring Architecture](../../../feature/scoring/architecture.md)、[Severity/Verdict](../../../feature/scoring/architecture/severity-and-verdict.md)、[证据完整性](../../../feature/scoring/architecture/evidence.md)。

| 契约 | 场景 |
|---|---|
| 链式句柄（`.atLeast(x)` / `.gate(x?)`）只改变已记录断言的 severity/threshold，evaluate 只执行一次 | 正例：atLeast 后 severity=soft、threshold=x、score 不变；边界：evaluate 恰一次 |
| `.atLeast(x)` 产生 soft threshold；`.gate()` 用默认通过线，`.gate(x)` 指定硬阈值并提级为 gate | 正例：gate(0.9) 下 0.8 → failed；边界：soft matcher 被 .gate() 提级 |
| Sandbox 延迟断言在 finalize 时读取求值；值 matcher 与 require 立即求值——两种时机产出同一种 AssertionResult | 边界：finalize 前 diff 变化只被延迟断言看到；正例：两类结果结构一致 |
| 五种评分来源（值/scope/judge/sandbox/效率）全部折叠进同一 collector 与同一 `assertions` 数组 | 正例：混合来源 finalize 输出单一有序数组 |
| AssertionResult 是 `outcome` 判别联合：passed/failed 分支必有 score（归一化），threshold 仅在设了阈值时出现，expected/received 是有界预览；unavailable 分支必有 reason、无 score | 正例：无阈值断言不含 threshold 键；边界：超长实际值被截断；反例：unavailable 条目不含 score 键 |
| 判定只消费 severity/outcome/optional/score/threshold | 边界：改 name/expected 不改变 computeVerdict 输出；正例：非 optional 断言 unavailable → errored，`.optional()` 的不影响 |

链式分级检查调用次数是有意义的，因为"延迟断言只求值一次"是生命周期契约；一般 helper 调用次数不是：

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
    outcome: "failed",
  })
  expect(evaluate).toHaveBeenCalledOnce()
})
```

## 证据完整性：负断言与上限断言

契约来源：[证据完整性](../../../feature/scoring/architecture/evidence.md)。Fixture 必须让完整性成为显式字段；不能用 `events: []` 同时表示"确认没有"和"没采到"。

| 契约 | 场景 |
|---|---|
| 负断言（notCalledTool/usedNoTools/notEvent）在证据不完整时不得给出可信 passed | 三列矩阵（见下） |
| 上限断言（maxTokens/maxCost/maxToolCalls）在 usage 缺失时不得静默通过 | 反例：usage 缺失时非 passed；边界：恰好等于上限 |
| 正断言（calledTool/event/loadedSkill）缺数据时失败，不从缺失推断存在 | 反例：空事件流 → failed |
| Scoring 不使用 OTel span 补写行为事件 | 边界：仅有 span 无标准事件时 calledTool 仍 failed |

| 证据 | `calledTool` | `notCalledTool` |
|---|---|---|
| 完整，且找到调用 | passed | failed |
| 完整，确认无调用 | failed | passed |
| 不完整，无法确认 | failed | 不得伪装成可信 passed |

## Severity 与 Verdict

契约来源：[Severity/Verdict](../../../feature/scoring/architecture/severity-and-verdict.md)、[Scoring CLI](../../../feature/scoring/cli.md)。优先级与 strict 适合表驱动，直接断言最终 Verdict。

| 契约 | 场景 |
|---|---|
| Verdict 按固定优先级取第一个成立项：errored > failed > skipped > passed | 决策表：error+failedGate+skip → errored；failedGate+skip → failed；仅 skip → skipped；全过 → passed |
| 任一 gate 失败即 failed，与 `--strict` 无关 | 正例：非 strict 下 failedGate → failed |
| 无阈值 soft 断言在任何模式（含 strict）下只记录分数、不影响 Verdict | 边界：strict + 无阈值 soft score 0 → passed |
| 带 `.atLeast(x)` 的 soft 仅在 strict 下影响 Verdict；非 strict 时结果仍记录 passed:false | 四象限（strict × 达标与否）；边界：score === threshold 恰好达标 → passed |
| 执行异常/超时/作者错误产生 errored 而非 failed，统计可区分，多 runs 不合并出第五种 Verdict | 反例：test 抛异常 → errored 不算 failed |
| `t.skip(reason)` 仅在无更高优先级失败时产生 skipped | 正例：先 skip 无断言 → skipped；反例：failedGate 后 skip → failed |

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

## Judge

契约来源：[Judge](../../../feature/scoring/library/judge.md)、[Scoring CLI](../../../feature/scoring/cli.md)。单测用 fixture judge client 验证请求材料与错误分类；真实裁判模型的端到端行为归 E2E。

| 契约 | 场景 |
|---|---|
| 未解析到模型 / API key 时 judge 断言记录为 `outcome: "unavailable"`（带 reason），绝不静默消失；非 `.optional()` 的使 attempt errored | 正例：缺 key 时 finalize 有一条 unavailable 且 verdict=errored；正例：`.optional()` 后 verdict 不受影响、条目仍在；反例：调用链 `.atLeast()` 不抛 |
| judge 断言默认 soft 无阈值；`.atLeast(x)` 加 soft 阈值，`.gate(x?)` 变硬要求 | 正例：默认低分不影响 Verdict；反例：gate 后低分 → failed；边界：score 归一到 0..1 |
| 模型解析优先级：单次 `{ model }` > eval judge config > 项目 judge config > `NICEEVAL_JUDGE_MODEL`，无内置默认 | 决策表：四层逐层覆盖；反例：全缺时不静默选一个 |
| 默认材料按接收者分层：t 评主 session 对话、session 评该 session、turn 评 turn.message；`{ on }` 覆盖 | 正例：请求材料随接收者不同；边界：on 为 diff 时不含对话 |
| judge 只有 closedQA / factuality / summarizes 三个固定入口 | 反例：访问不存在入口报错 |

## 不这样测

- 不给每个 matcher 都重复测试 `.gate()`；链式分级在共享 collector 契约测试一次。
- 不断言 `computeVerdict` 内部先执行哪个 `if`，只断言冲突输入的最终优先级。
- 不用所有 scope 都会通过的事件 fixture。
- 不把 judge HTTP client 的 mock 返回值原样断言成 score；要验证请求材料、错误分类、缺 key 和 score 归一。
