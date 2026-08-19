# Assertions、Judge 与 Verdict 怎么测

契约出处：

- [Assertions](../../../feature/assertions/README.md)
- [值断言](../../../feature/assertions/library/value-assertions.md)
- [作用域断言](../../../feature/assertions/library/scoped-assertions.md)
- [Judge](../../../feature/judge/library.md)
- [Sample](../../../feature/assertions/architecture/scopes.md)
- [证据完整性](../../../feature/assertions/architecture/evidence.md)
- [Severity / Verdict](../../../feature/verdict/architecture.md)
- [断言与 Turn 的展示](../../../feature/assertions/library/display.md)
- [Verdict CLI](../../../feature/verdict/cli.md)

判定层给出“看似合理但错误的答案”的代价最高，因此测试预算也最高。
裁决出处见[test-budget-inverted-pyramid](../../../../memory/test-budget-inverted-pyramid.md)。

本篇构造证据图（`AssertionEvaluationContext`）作为输入。
Judge 只 fake 传输层，测试其上的判定逻辑。
真实证据与真实裁判模型由[E2E 适配器域](../e2e/adapter/README.md)验收。
Fake 规则见[单元测试边界](README.md#fake-边界mock-什么测哪一层)。

## 观察面与边界

| 契约域             | 观察面                                        | 边界                                         |
| ------------------ | --------------------------------------------- | -------------------------------------------- |
| matcher 评分语义   | `score(value)` 的返回值与默认 severity        | 领域规则，直接测 matcher                     |
| collector 生命周期 | `finalize()` 形成的 Assertion result 集      | 组件协作                                     |
| scope 数据范围     | 同一证据图下三个接收者的判定差异              | 组件协作                                     |
| 证据完整性         | 负断言/上限断言在三种完整性状态下的结果       | 领域规则 + 组件协作                          |
| Verdict 优先级     | `computeVerdict` 决策表                       | 领域规则                                     |
| 摘要投影           | display 纯函数的输出字符串语义                | 领域规则                                     |
| judge              | 发往裁判模型的请求材料、错误分类、缺 key 行为 | fixture judge client（截获 fetch，不出网络） |

## Fixture 规范

Collector 的 fixture 提供最小完整 `AssertionEvaluationContext`，每个字段默认采用"明确空"而不是 `undefined`：

```ts
function assertionEvaluationContext(overrides: Partial<AssertionEvaluationContext> = {}): AssertionEvaluationContext {
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
    async readText() {
      return undefined;
    },
    ...overrides,
  };
}
```

当测试"证据未知"时必须显式构造 unknown/incomplete 状态，不能复用上面的明确空 fixture——`events: []`不允许同时表示"确认没有"和"没采到"（规则见 [Harness](harness.md)）。

Scope fixture 必须让三个接收者得到**不同答案**，才能发现 selector 被错误复用；三个 scope 都只含一个相同事件的 fixture 没有区分力。
典型构造：事件只出现在某一个 session 的某一轮，使 turn 级、session 级、attempt 级判定互不相同。

## 证明范围规范

- **内置 matcher**：每个 matcher 都要证明会改变得分的等价类（命中/未命中/非法类型输入）、默认 severity、niceeval 附加语义（去重、行首识别、深相等、归一化范围）。
  不测试 JavaScript 标准库本身；`makeAssertion`的错误捕获与文本回退（stack 优先、非 Error 值字符串化）单独证明。
- **值断言入口**：`check` 调用即登记并继续；需要硬判定时链 `.gate()`，需要停止当前 continuation 时 `await .orStop()`。失败保留已写条目并中止、通过透传原引用。
  `group` 只组织报告不改变语义；值断言只评显式传入的值，不隐式读取 scope 证据。`CommandResult` 失败摘要的构成：首行、尾部段、evidence 取命令行。
- **ToolMatch 的 match 小语言**：`calledTool` / `notCalledTool` 接收名称或 `ToolMatch`；当前没有 `calledSubagent` 作者 API。
  - `input` 与 `output` 都是 `jsonMatch(...)`、`referencesAnyPath(...)` 等受管值 Match；它们在同一个 logical occurrence 上与名称、状态做 AND。
  - `count` 只接受正整数（确切次数）或 `{ atLeast: 正整数 }`；计数需要完整证据，不能由 predicate 自定义。
  - `status` 只接受已完成生命周期的 `completed`、`failed` 或 `rejected`；未完成的 HITL 调用用 `calledTool(name)` 证明已发起，并单独检查 Turn 的 `waiting` 状态。
- **Scope**：同名断言挂三个接收者时按各自数据范围判定；session 时点 Run 不被后续事件追溯；新 session 事件进 `t.*` 聚合但不进主 session 即时视图。
  - 子序列匹配类断言的顺序语义；`succeeded()` 与 `t.check(turn.status, equals("waiting"))` 在同一 Turn 状态上互斥；接收者专属能力不下放（类型负例）。
- **Collector 生命周期**：
  - 链式句柄只修改 Severity 与 threshold，evaluate 恰好执行一次。
  - 延迟断言在 finalize 时求值；即时断言立即求值。
    两者形成同构的 Assertion result。
  - 五种评分输入进入同一个 Collector。
    判定只消费已声明字段。
  - Assertion result 的判别联合提供有界预览；值为 `undefined` 时也不能崩溃。
- **可选与硬判定**：Pass Eval 的 Assertion 默认 required；`.optional()` 只把 unavailable/errored 从 Verdict 的独立错误中排除，`.gate()` 把 Boolean 或 thresholded measurement 纳入 failed fold。
- **`.orStop()`** 在链的位置立即结算且只对 condition 未满足时中止当前 continuation；通过返回原引用，已登记结果仍会封口。它不是第二条 Assertion。
- **计分制给分链路（`.score(n)` / `t.score(n)`）**：Score Eval 的 handle `.score(n)` 把 points 挂上 entry；`finalize` 保存声明值与 earned contribution，按 `measurement × points` 计算 earned。
  - 0/1 断言通过挣 `n`、不过挣 0；连续打分断言按比例。failed 与 unavailable 都保留 `pointsAvailable`，unavailable 没有实得 `points`；`n <= 0` 或非有限数立即抛错（不是记一条失败断言）。
  - `AssertionCollector.score(label, n)` 立即形成一条 Score contribution（不像断言那样等 finalize
    求值），`n < 0` 或非有限数立即抛错；`groupPath` 跟随当前 `t.group` 栈，与断言同一份分组约定。
  - 未链 `.score()` 的 Assertion 不贡献 score；缺失与 `0` 是不同读数。
  - Score Eval 没有 gate/optional policy；丢分本身不改 Verdict，缺少必要 score material 才会使结果不可比较。
- **控制流与判定正交**：`.gate()` 只改变 Verdict fold；`.orStop()` 才在调用位置求值并中止当前 continuation。已产生的 contribution 照实保留，sealed result 不因后续事件或文件变化重算。
- **证据完整性**：负断言与上限断言在「完整且找到 / 完整且确认无 / 不完整」三态矩阵下的结果——不完整时绝不给出可信 passed。正断言缺数据时失败不猜；不用 OTel span 补写行为事件。
  这一族的 fixture 必须让完整性是显式字段。
- **Severity 与 Verdict**：`computeVerdict` 用决策表直接断言冲突输入的最终优先级（errored > failed > skipped > passed）。
  - 计分制丢分本身不改 Verdict；Pass Eval 只有显式 `.gate()` 才把不满足条件折叠为 `failed`。
  - `.atLeast` 的阈值与恰好达标边界；执行异常是 errored 不是 failed；skip 的优先级。
  - `gate()` 对 Boolean 结果按 matched/mismatched 折叠；measurement 使用 `gate(n)` 直接设置阈值并进入 failed。
- **摘要投影（display）**：控制字节剥离的保留/去除边界、单值收口的折行与上限、宽度预算下的让位优先级。`+N more failures` 的独立尾行不变量、作用域前缀规则。
  全部是纯函数字符串语义，输入输出直接断言。
- **judge**：缺模型/缺 key 形成 `unavailable` Assertion result（`judge-model-unresolved`），非 optional 使 Attempt 形成 `errored` Verdict、绝不静默消失；默认 soft 与链式提级。
  - model 按单条 → Experiment → Eval → config、其余键按 Experiment → Eval → config 逐字段求值，并落在捕获请求的 URL 与头上；Experiment 不能改变 rubric / severity / threshold。
  - 判卷材料随接收者分层、`{ on }` 替换；入口封闭。
  真实裁判模型的端到端行为归 E2E。
- **judge 调用失败不落成 0 分**：判分请求非 2xx、连接中途断开、调用超时，以及 2xx 但响应取不出分数（不合协议、分数字段缺失）——四种形态各一条。
  - 断言记的是 `outcome: "unavailable"` + `reason: "judge-call-failed"` + `evidence` 带状态码/异常摘要，**不是 `outcome: "passed"` + `score: 0`**。
  区分力场景：同一条 rubric 在「网关回 400」与「agent 答得完全跑题」两份 fixture 下，落盘条目必须不同——这正是分数面上分不出「裁判失败」和「答错了」的那一格。
  非 optional 时同样形成 `errored` Verdict。
- **Judge 静态配置校验与调用期 unavailable**：非法 `baseUrl` / `apiKeyEnv` 在配置求值期失败，且仅配置 Judge 不发请求。
  - 缺 model / 缺 key 分别写入 `judge-model-unresolved` / `judge-key-unresolved`；鉴权、连接、超时和响应解码失败写入 `judge-call-failed`。
  每类都涵盖 optional 与非 optional，证明前者保留 unavailable Assertion result 但不改 Verdict，后者形成 `errored` Verdict。
  真实网关行为归 E2E。
- **judge 调用超时预算（`judge.timeoutMs`）**：契约见[Judge · 调用预算与执行顺序](../../../feature/judge/library.md#调用预算与执行顺序)。
  fake 时钟 +截获 fetch，不真等。
  - 到点不回的判分调用被中断，记 `outcome: "unavailable"` + `reason: "judge-call-failed"`，`evidence` 写明超时秒数；同一挂起 fixture 在配了更长 `timeoutMs` 时正常拿到分数（区分力一格）。
  - 默认 180_000 的生效路径要真跑到——不配 `timeoutMs` 的调用同样被中断，不是无限等。
  - 逐字段求值走单条断言 `{ model }` → experiment → eval → config，与 [experiments-runner 同名类别](experiments-runner.md#证明范围规范)是同一契约。
    「config 写 `timeoutMs`、Eval 写 `baseUrl`、Experiment 只写 `model`」这一格必须三层各取一个值而不是整对象替换——这是逐字段合并与整体替换结果不同的一格。
- **finalize 的 judge 推进回调**：逐条 judge 求值开始前回调一次进度（第几条 / judge 总数 /检查方式摘要，摘要与落盘 `detail` 同源）。
  非 Judge 断言不回调，无 Judge 断言时零次回调；回调不进 Assertion result，也不落盘。
  runner 侧把回调接到 active 行 detail 的接线归 [Experiments Runner](experiments-runner.md#证明范围规范)。

## 不这样测

- 不给每个 matcher 都重复测试 `.gate()`；句柄策略在共享 Assertions 契约测试一次。
- 不断言 `computeVerdict` 内部先执行哪个 `if`，只断言冲突输入的最终优先级。
- 不用所有 scope 都会通过的事件 fixture。
- 不把 judge HTTP client 的 mock 返回值原样断言成 score；要验证请求材料、错误分类、缺 key 和 score 归一。
