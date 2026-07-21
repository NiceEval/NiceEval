# Scoring 与断言怎么测

契约来源：[Scoring](../../../feature/scoring/README.md)、[值断言](../../../feature/scoring/library/value-assertions.md)、[作用域断言](../../../feature/scoring/library/scoped-assertions.md)、[Judge](../../../feature/scoring/library/judge.md)、[Scope](../../../feature/scoring/architecture/scopes.md)、[证据完整性](../../../feature/scoring/architecture/evidence.md)、[Severity/Verdict](../../../feature/scoring/architecture/severity-and-verdict.md)、[断言与 Turn 的展示](../../../feature/scoring/library/display.md)、[Scoring CLI](../../../feature/scoring/cli.md)。判定层给出"看似合理但错误的答案"的代价最高，是全套件预算最重的领域（裁决出处见 memory 的 [test-budget-inverted-pyramid](../../../../memory/test-budget-inverted-pyramid.md)）。本篇的缝：构造证据图（`ScoringContext`）作输入、judge 只 fake 传输层，测其上的判定逻辑；缝的真实侧（真实证据与真实裁判模型）由 [E2E 适配器域](../e2e/adapter/README.md)验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。

## 观察面与边界

| 契约域 | 观察面 | 边界 |
|---|---|---|
| matcher 评分语义 | `score(value)` 的返回值与默认 severity | 领域规则，直接测 matcher |
| collector 生命周期 | `finalize()` 产出的 AssertionResult 数组 | 组件协作 |
| scope 数据范围 | 同一证据图下三个接收者的判定差异 | 组件协作 |
| 证据完整性 | 负断言/上限断言在三种完整性状态下的结果 | 领域规则 + 组件协作 |
| Verdict 优先级 | `computeVerdict` 决策表 | 领域规则 |
| 摘要投影 | display 纯函数的输出字符串语义 | 领域规则 |
| judge | 发往裁判模型的请求材料、错误分类、缺 key 行为 | fixture judge client（截获 fetch，不出网络） |

## Fixture 规范

Collector 的 fixture 提供最小完整 `ScoringContext`，每个字段默认采用"明确空"而不是 `undefined`：

```ts
function scoringContext(
  overrides: Partial<ScoringContext> = {},
): ScoringContext {
  return {
    events: [],
    facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0 },
    diff: { files: [] },
    scripts: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed",
    async readFile() { return undefined },
    ...overrides,
  }
}
```

当测试"证据未知"时必须显式构造 unknown/incomplete 状态，不能复用上面的明确空 fixture——`events: []` 不允许同时表示"确认没有"和"没采到"（规则见 [Harness](harness.md)）。

Scope fixture 必须让三个接收者得到**不同答案**，才能发现 selector 被错误复用；三个 scope 都只含一个相同事件的 fixture 没有区分力。典型构造：事件只出现在某一个 session 的某一轮，使 turn 级、session 级、attempt 级判定互不相同。

## 覆盖规范

- **内置 matcher**：每个 matcher 覆盖会改变得分的等价类（命中/未命中/非法类型输入）、默认 severity、niceeval 附加语义（去重、行首识别、深相等、归一化范围）。不测试 JavaScript 标准库本身；`makeAssertion` 的错误捕获与文本回退（stack 优先、非 Error 值字符串化）单独证明。
- **值断言入口**：`check` 记录后继续、`require` 失败按 gate 中止且通过时透传原引用、`group` 只组织报告不改变语义；值断言只评显式传入的值，不隐式读取 scope 证据；`CommandResult` 失败摘要的构成（首行、尾部段、evidence 取命令行）。
- **Scope**：同名断言挂三个接收者时按各自数据范围判定；session 时点快照不被后续事件追溯；新 session 事件进 `t.*` 聚合但不进主 session 即时视图；子序列匹配类断言的顺序语义；互斥断言对（`succeeded`/`parked`）在同一证据上反转；接收者专属能力不下放（类型负例）。
- **Collector 生命周期**：链式句柄只改 severity/threshold 且 evaluate 恰好一次（这里断言调用次数是有意义的——"延迟断言只求值一次"本身是生命周期契约）；延迟断言 finalize 时求值、即时断言立即求值、两者产出同构 AssertionResult；五种评分来源折叠进同一 collector；AssertionResult 判别联合的字段构成与有界预览（含 `undefined` 值不崩溃）；判定只消费声明的字段。
- **证据完整性**：负断言与上限断言在「完整且找到 / 完整且确认无 / 不完整」三态矩阵下的结果——不完整时绝不给出可信 passed；正断言缺数据时失败不猜；不用 OTel span 补写行为事件。这一族的 fixture 必须让完整性是显式字段。
- **Severity 与 Verdict**：`computeVerdict` 用决策表直接断言冲突输入的最终优先级（errored > failed > skipped > passed）；gate 与 strict 的正交；无阈值 soft 永不影响判定；`.atLeast` 的 strict 四象限与恰好达标边界；执行异常是 errored 不是 failed；skip 的优先级。
- **摘要投影（display）**：控制字节剥离的保留/去除边界、单值收口的折行与上限、宽度预算下的让位优先级、`+N more failures` 的独立尾行不变量、作用域前缀规则。全部是纯函数字符串语义，输入输出直接断言。
- **judge**：缺模型/缺 key 记 `unavailable` 且非 optional 使 attempt errored、绝不静默消失；默认 soft 与链式提级；模型与端点/凭据的解析优先级逐层可区分且落在捕获请求的 URL 与头上；判卷材料随接收者分层、`{ on }` 覆盖；入口封闭。真实裁判模型的端到端行为归 E2E。

## 不这样测

- 不给每个 matcher 都重复测试 `.gate()`；链式分级在共享 collector 契约测试一次。
- 不断言 `computeVerdict` 内部先执行哪个 `if`，只断言冲突输入的最终优先级。
- 不用所有 scope 都会通过的事件 fixture。
- 不把 judge HTTP client 的 mock 返回值原样断言成 score；要验证请求材料、错误分类、缺 key 和 score 归一。
