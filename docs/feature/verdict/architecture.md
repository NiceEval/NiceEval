# Verdict 与 Severity

一条断言链上什么词，决定它失败怎样向上传播。
本篇是**判定面**的单源：两种题型各一段标注代码，每个词旁边写「失败会怎样」。
分数怎么算、每个词落到哪个读数见 [计分粒度](../assertions/library/score-points.md)，matcher 自带的通过线见 [值断言](../assertions/library/value-assertions.md#内置-matcher)。

## Severity

`defineEval` 的 `t` 上，严重度既可以链在 matcher 上，也可以链在作用域断言的句柄上。
不链词就用 matcher 自带的默认严重度。

```typescript
export default defineEval({
  async test(t) {
    await t.send("查一下布鲁克林今天的天气。");

    t.check(t.reply, includes("Brooklyn"));
    //  不链词 → 用 matcher 自带的严重度，includes 默认 gate：没命中 → 这次 attempt failed

    t.check(t.reply, similarity(expected).gate(0.8));
    //  .gate(x) → 硬要求：分数低于 0.8 → failed
    //  省略 x 用默认通过线 1，也就是 matcher 自身的及格线（0/1 断言即「命中」）

    t.check(t.reply, similarity(expected).atLeast(0.7));
    //  .atLeast(x) → 降级为带通过线的 soft：低于 0.7 照实记 failed，verdict 不动
    //  --strict 下这条线翻成 gate → failed
    //  x 是分数线：0/1 断言写 .atLeast(1)，打分断言写 .atLeast(0.7)

    t.calledTool("get_weather", { count: 2 }).atLeast(1);
    //  作用域断言默认 gate，降级同样链这三个词
    //  「至少调用 2 次」是匹配条件，写在 count 里，不写成严重度的参数

    t.judge.autoevals.closedQA("回答准不准？").optional();
    //  judge 的默认严重度是无线的 .soft()：分数如实落盘、永不 fail
    //  .soft() 无参数——要设线用 .atLeast(x)，不提供同义的 soft(x)
    //  .optional() 与上面三个词正交：它管证据允不允许缺席，不管判定怎么传播（见下）
  },
});
```

`.atLeast` 的参数是分数线，不是调用次数——次数与其余匹配条件都在 [`ToolMatch`](../assertions/library/scoped-assertions.md#匹配条件的字段全集) 里表达。

severity 只管**判定面**：它声明一条断言的失败怎么向上传播，同一语义沿组、eval、experiment 逐层作用，不按层另设规则。
`--strict` 是作用于所有层的同一个旋钮——它把带线 soft 翻成 gate，只改判定传播，分数照记。
质量分（soft 断言的均值）与分数面（计分制的给分）是另外两个读数，折叠规则见[计分粒度](../assertions/library/score-points.md#折叠树判定面分数面质量分)。

## 控制流与严重度正交

`.gate()` 在 `defineEval` 与 `defineScoreEval` 中始终表示同一件事：断言不通过使 Attempt `failed`。
它不改变 `test()` 控制流。
后续代码依赖这条断言时，显式链 `.stopOnFailure()`；值断言可用两种题型都有的 `t.require()` 简写。

```typescript
export default defineScoreEval({
  async test(t) {
    await t.send("把 DB-GPT 装起来并通过健康检查。");

    await t.require(await t.sandbox.pathExists("db-gpt/README.md"), isTrue());
    //  等价于 t.check(...).gate().stopOnFailure()：记硬失败，并停止依赖它的后续代码

    t.sandbox.fileChanged("db-gpt/.env").points(1);
    //  .points(n) = 得分点：通过挣 n 分、不过挣 0 分，继续往下跑

    await t.calledTool("shell", { input: { command: /pip install/ } })
      .points(1).gate().stopOnFailure();
    //  得分点兼硬要求：丢 1 分、Attempt failed，并停止后续代码

    t.judge.autoevals.closedQA("说明讲清动机没有？").atLeast(0.6);
    //  .atLeast(x) = soft 通过线；低于线如实记 failed，--strict 下升级为 gate

    t.check(t.reply, includes("healthy"));
    //  不链词 = 观测：进质量分；matcher 自带的通过线照常生效，没做到如实记 failed
    //  .soft() 再把这条线也去掉——纯记录一个分数、永不 failed
  },
});
```

`.stopOnFailure()` 在写下的位置立即结算断言；通过时返回原值或句柄，失败时登记既定 AssertionResult 并中止 `test()`。
它不能单独出现，必须跟在带通过线的 `.gate()` / `.atLeast()` 或使用 matcher 默认通过线的断言之后。
`.gate().stopOnFailure()` 是硬前置；`.atLeast(x).stopOnFailure()` 只停止后续代码，仍保持 soft 严重度。
控制流不再借 severity 一词表达。

`--strict` 对两种题型同义：带线 soft 升级为 gate，但不自行添加 `.stopOnFailure()`。

## Verdict

Verdict 只有 passed、failed、errored、skipped，按固定优先级取第一个成立项：

```text
执行异常、超时、作者错误，或任一非 optional 断言 unavailable   → errored
任一 gate 不通过，或 strict 下任一 soft 不通过                 → failed
显式 t.skip(reason)                                            → skipped
否则                                                           → passed
```

Errored 压过一切，因为执行证据已经不可信。
Failed 压过 skipped，避免 `t.skip()` 掩盖此前登记的硬失败。

计分制（`defineScoreEval`）使用同一张表。
得分点丢分本身不产生 failed；显式 gate 不通过仍产生 failed。
`.stopOnFailure()` 只决定是否继续执行，不新增第五种 Verdict。

## 证据不可用（unavailable）不折叠成通过

一条断言评不了和它通过、失败都是两回事。
以下情况把该条 `AssertionResult` 记为 `outcome: "unavailable"`（带机器可读 `reason`），绝不静默丢弃、绝不按空证据判通过：

- **负断言与上限断言的证据通道不完整**——`notEvent` / `usedNoTools` 这类「确认没发生」的断言，以及 token / cost 上限断言，都依赖完整采集。
  所需通道非 complete 时，空流不能证明「没发生」，缺 usage 不能按零聚合；unknown 也属于这种情况，见 [证据与完整性](../assertions/architecture/evidence.md)。
- **正断言在非 complete 通道上没找到匹配**——「没采到」不能算成「Agent 没做」；找到匹配则照常通过（证据存在就是证据），complete 通道上没找到才是 failed。
- **judge 没有找到模型或 API key**——rubric 写了就必须留下条目（见 [LLM-as-judge](../judge/library.md)）。
- **judge 调用没有产出可信分数**——请求发出去了但失败（HTTP 非 2xx、连接中断、单次调用超时），或响应回来了但取不出分数（不合协议、分数缺失或无法解读）。
  判分请求失败与 agent 没做到在分数面上必须可分辨：**这种情况绝不落成 `score: 0` 的通过条目**，否则「裁判失败」和「答得一塌糊涂」在报告里长得一模一样，而前者是要修配置、后者是要修 agent。
  `reason` 用 `judge-call-failed`，状态码或异常摘要进 `evidence`。

折叠规则只有一条：**作者写下的每条断言默认都要求可评估**——任一非 optional 断言 unavailable，attempt 即 `errored`，不分 gate / soft。
评不了的判定不可信，不能当 agent 答对，也不该当 agent 答错；「soft 全部评不了但 attempt 还绿着」是没有测量的绿，不允许出现。
确实允许缺席的断言由作者显式链 `.optional()`——它的 unavailable 只保留在条目里由报告如实展示，不影响 Verdict。
optional 与 severity 正交： severity 说「影不影响质量判定」，optional 说「证据允许不允许缺席」，不互相复用。

Turn failed 和 attempt errored 不是同一概念：Agent 行为失败可以形成可评分结果；基础设施、超时或作者异常使本次执行无法形成可信判定。
