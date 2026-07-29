# Assertions、Judge 与 Verdict 怎么测

契约来源：

- [Assertions](../../../feature/assertions/README.md)
- [值断言](../../../feature/assertions/library/value-assertions.md)
- [作用域断言](../../../feature/assertions/library/scoped-assertions.md)
- [Judge](../../../feature/judge/library.md)
- [Sample](../../../feature/assertions/architecture/scopes.md)
- [证据完整性](../../../feature/assertions/architecture/evidence.md)
- [Severity / Verdict](../../../feature/verdict/architecture.md)
- [断言与 Turn 的展示](../../../feature/assertions/library/display.md)
- [Verdict CLI](../../../feature/verdict/cli.md)

判定层给出“看似合理但错误的答案”的代价最高，因此测试预算也最高。裁决出处见
[test-budget-inverted-pyramid](../../../../memory/test-budget-inverted-pyramid.md)。

本篇构造证据图（`ScoringContext`）作为输入。Judge 只 fake 传输层，测试其上的判定逻辑。真实证据与真实裁判模型由
[E2E 适配器域](../e2e/adapter/README.md)验收。Fake 规则见[单元测试边界](README.md#fake-边界mock-什么测哪一层)。

## 观察面与边界

| 契约域             | 观察面                                        | 边界                                         |
| ------------------ | --------------------------------------------- | -------------------------------------------- |
| matcher 评分语义   | `score(value)` 的返回值与默认 severity        | 领域规则，直接测 matcher                     |
| collector 生命周期 | `finalize()` 产出的 AssertionResult 数组      | 组件协作                                     |
| scope 数据范围     | 同一证据图下三个接收者的判定差异              | 组件协作                                     |
| 证据完整性         | 负断言/上限断言在三种完整性状态下的结果       | 领域规则 + 组件协作                          |
| Verdict 优先级     | `computeVerdict` 决策表                       | 领域规则                                     |
| 摘要投影           | display 纯函数的输出字符串语义                | 领域规则                                     |
| judge              | 发往裁判模型的请求材料、错误分类、缺 key 行为 | fixture judge client（截获 fetch，不出网络） |

## Fixture 规范

Collector 的 fixture 提供最小完整 `ScoringContext`，每个字段默认采用"明确空"而不是 `undefined`：

```ts
function scoringContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
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
    async readFile() {
      return undefined;
    },
    ...overrides,
  };
}
```

当测试"证据未知"时必须显式构造 unknown/incomplete 状态，不能复用上面的明确空 fixture——`events: []`
不允许同时表示"确认没有"和"没采到"（规则见 [Harness](harness.md)）。

Scope
fixture 必须让三个接收者得到**不同答案**，才能发现 selector 被错误复用；三个 scope 都只含一个相同事件的 fixture 没有区分力。典型构造：事件只出现在某一个 session 的某一轮，使 turn 级、session 级、attempt 级判定互不相同。

## 覆盖规范

- **内置 matcher**：每个 matcher 覆盖会改变得分的等价类（命中/未命中/非法类型输入）、默认 severity、niceeval 附加语义（去重、行首识别、深相等、归一化范围）。不测试 JavaScript 标准库本身；`makeAssertion`
  的错误捕获与文本回退（stack 优先、非 Error 值字符串化）单独证明。
- **值断言入口**：`check` 记录后继续、`require` 失败按 gate 中止且通过时透传原引用、`group`
  只组织报告不改变语义；值断言只评显式传入的值，不隐式读取 scope 证据；`CommandResult`
  失败摘要的构成（首行、尾部段、evidence 取命令行）。
- **ToolMatch/SubagentMatch 的 match 小语言**：`calledTool`/`notCalledTool`/`calledSubagent` 的
  `match` 参数各字段独立形态与命中语义——`input`
  顶层给对象是深度部分匹配、给 RegExp 是测序列化后的完整输入、给谓词函数是拿原始值自行判断，三种形态互不退化（回归：RegExp 实例误落深比对分支、枚举其自身空可枚举属性、静默匹配一切调用，必须锁死为不匹配）；`output`
  同样支持深度部分匹配、RegExp（非字符串先序列化再测）、谓词函数与严格相等四种值语义；`count`
  数字精确匹配与谓词自定义判定两种形态，且只有数字精确形态在实测超出时才是确凿失败，谓词形态不满足时按覆盖折叠走
  `unavailable`；`remoteUrl` 字符串精确、RegExp、谓词函数三种形态；`status` 按 `ToolMatch` 四态（含
  `pending`）与 `SubagentMatch` 三态（无 `rejected`）过滤，且不带 `status` 过滤时匹配任意状态。
- **Scope**：同名断言挂三个接收者时按各自数据范围判定；session 时点 Run 不被后续事件追溯；新 session 事件进
  `t.*`
  聚合但不进主 session 即时视图；子序列匹配类断言的顺序语义；互斥断言对（`succeeded`/`parked`）在同一证据上反转；接收者专属能力不下放（类型负例）。
- **Collector 生命周期**：
  - 链式句柄只修改 Severity 与 threshold，evaluate 恰好执行一次。
  - 延迟断言在 finalize 时求值；即时断言立即求值。两者产生同构的 `AssertionResult`。
  - 五种评分来源进入同一个 Collector。判定只消费已声明字段。
  - `AssertionResult` 判别联合提供有界预览；值为 `undefined` 时也不能崩溃。
  - 无参 `.soft()` 把断言降为纯记录，并清除已有 threshold。
  - `.soft()`、`.gate()` 与 `.atLeast()` 共用一份 `RecordHandle` 契约测试，不按 matcher 重复。
- **`.soft()` 对判定的影响**：分数照实落盘（`AssertionResult.score`
  保留原始分，不因降级为 soft 被抹掉）；`outcome` 恒为 `passed`（`computePassed` 对 threshold
  undefined 的 soft 恒返回 true）；`computeVerdict` 无论 `strict` 是否为真都不会因这条断言判
  `failed`——`--strict` 只翻转「有阈值的 soft」，无阈值的 soft 没有阈值可比较，不受这个旋钮影响。
- **计分制给分链路（`.points(n)` / `t.score(label, n)`）**：`RecordHandle.points(n)`
  把权重挂上 spec，`finalize` 按 `n × score` 写进 `AssertionResult.points`（0/1 断言通过挣
  `n`、不过挣 0；连续打分断言按比例）；`n <= 0`
  或非有限数立即抛错（不是记一条失败断言）。`AssertionCollector.score(label, n)` 立即记录一条
  `ScoreEntry`（不像断言那样等 finalize 求值），`n < 0` 或非有限数立即抛错；`groupPath` 跟随当前
  `t.group` 栈,与断言同一份分组约定。未链 `.points()` 的断言 `AssertionResult.points` 省略（不是
  `0`）——省略与 0 分是两个读数，省略表示这条断言不参与计分。得分点落盘为 `severity: "soft"` + 有
  `points`，丢分不改 verdict；`.points()` 之后只能链 `.gate()` / `.optional()`，`.soft()` /
  `.atLeast()` 在得分点句柄上不存在（类型层证明，见 typecheck fixture）；未链 `.points()` 的
  `.atLeast(x)` 是观测通过线，低于线记 failed 且 `--strict` 下也不翻 verdict（`computeVerdict`
  在计分制不读 strict）。
- **计分制的前置中止（`.gate()`）**：链了 `.gate()` 的断言就地求值（不进延迟队列），未过时后续 `t.*`
  调用与 `test()` 收尾抛中止信号、其后的断言与 `ScoreEntry`
  不再出现在结果里，已产生的照实保留；作者写不写 `await` 结论一致（收集器在每个 `t.*`
  入口先结算待决前置）——两种写法各测一次。`.points(n).gate()`
  的断言同时挣分与中止，两个字段互不覆盖。matcher 自带的默认 severity（`includes`
  等默认 gate）与 matcher 上链的 `.gate(x)` 在计分制只贡献
  `threshold`、不触发中止：中止只由断言句柄上的 `.gate()`
  声明（这条是回归守护——默认 gate 的 matcher 若触发中止，计分制的第一条检查点就会腰斩整题）；降级保留通过线（gate 省略阈值时留默认满分线），所以没做到的检查点照记
  `failed` 挣 0 分，`--strict` 下也不翻 verdict。
- **证据完整性**：负断言与上限断言在「完整且找到 / 完整且确认无 / 不完整」三态矩阵下的结果——不完整时绝不给出可信 passed；正断言缺数据时失败不猜；不用 OTel
  span 补写行为事件。这一族的 fixture 必须让完整性是显式字段。
- **Severity 与 Verdict**：`computeVerdict` 用决策表直接断言冲突输入的最终优先级（errored > failed >
  skipped > passed）；计分制 attempt 的 `failed` 只由前置中止产生——丢分（含全部得分点挂掉）仍是
  `passed`，`errored` / `skipped`
  与通过制同义；gate 与 strict 的正交；无阈值 soft 永不影响判定；`.atLeast`
  的 strict 四象限与恰好达标边界；执行异常是 errored 不是 failed；skip 的优先级；`computePassed`
  在 gate 省略阈值时的默认通过线是满分（`score >= 1`）——0/1 matcher（如
  `equals`/`includes`，命中即 1、不命中即 0）不受这条默认线影响，连续打分的 gate 断言（省略阈值的 judge 类）未达满分即 fail、恰好满分才 pass。
- **摘要投影（display）**：控制字节剥离的保留/去除边界、单值收口的折行与上限、宽度预算下的让位优先级、`+N more failures`
  的独立尾行不变量、作用域前缀规则。全部是纯函数字符串语义，输入输出直接断言。
- **judge**：缺模型/缺 key 记 `unavailable`（`judge-model-unresolved`）且非 optional 使 attempt
  errored、绝不静默消失；默认 soft 与链式提级；模型与端点/凭据的解析优先级逐层可区分且落在捕获请求的 URL 与头上；判卷材料随接收者分层、`{ on }`
  覆盖；入口封闭。真实裁判模型的端到端行为归 E2E。
- **judge 调用失败不落成 0 分**：判分请求非 2xx、连接中途断开、调用超时，以及 2xx 但响应取不出分数（不合协议、分数字段缺失）——四种形态各一条，断言记的是
  `outcome: "unavailable"` + `reason: "judge-call-failed"` + `evidence` 带状态码/异常摘要，**不是 `outcome: "passed"` + `score: 0`**。区分力场景：同一条 rubric 在「网关回
  400」与「agent 答得完全跑题」两份 fixture 下，落盘记录必须不同——这正是分数面上分不出「裁判失败」和「答错了」的那一格。非 optional 时同样使 attempt errored。
- **Judge 静态配置校验与调用期 unavailable**：非法 `baseUrl` / `apiKeyEnv` 在解析期失败，且仅配置
  Judge 不发请求；缺 model / 缺 key 分别记录 `judge-model-unresolved` / `judge-key-unresolved`，
  鉴权、连接、超时和响应解析失败记录 `judge-call-failed`。每类都覆盖 optional 与非 optional，证明
  前者保留 unavailable 但不改 verdict，后者使 attempt errored。真实网关行为归 E2E。
- **judge 调用超时预算（`judge.timeoutMs`）**：契约见
  [Judge · 调用预算与执行顺序](../../../feature/judge/library.md#调用预算与执行顺序)。fake 时钟 +
  截获 fetch，不真等。
  - 到点不回的判分调用被中断，记 `outcome: "unavailable"` + `reason: "judge-call-failed"`，
    `evidence` 写明超时秒数；同一挂起 fixture 在配了更长 `timeoutMs` 时正常拿到分数（区分力一格）。
  - 默认 180_000 的生效路径要真跑到——不配 `timeoutMs` 的调用同样被中断，不是无限等。
  - 解析逐字段走 eval → config → 默认，与
    [experiments-runner 同名类别](experiments-runner.md#覆盖规范)是同一契约。
    「config 的 `judge` 写了 `timeoutMs`、eval 写了自己的 `judge` 但没写」这一格取 config
    的值而不是默认——逐字段合并与整体覆盖唯一读数不同的一格，必测。
- **finalize 的 judge 推进回调**：逐条 judge 求值开始前回调一次进度（第几条 / judge 总数 /
  检查方式摘要，摘要与落盘 `detail` 同源）。非 judge 断言不回调，无 judge 断言时零次回调；回调
  不进 `AssertionResult` 也不落盘。runner 侧把回调接到 active 行 detail 的接线归
  [Experiments Runner](experiments-runner.md#覆盖规范)。

## 不这样测

- 不给每个 matcher 都重复测试 `.gate()`；链式分级在共享 collector 契约测试一次。
- 不断言 `computeVerdict` 内部先执行哪个 `if`，只断言冲突输入的最终优先级。
- 不用所有 scope 都会通过的事件 fixture。
- 不把 judge HTTP
  client 的 mock 返回值原样断言成 score；要验证请求材料、错误分类、缺 key 和 score 归一。
