# Severity 与 Verdict

## Severity

- **gate**：硬要求，通过线默认 1（matcher 自身的及格线），不过即 failed。
- **soft**：质量指标。**无通过线＝纯记录**，分数如实落盘、永不 fail；**有通过线**＝低于线记该条 failed，默认不改 Verdict，strict 模式下才计入。

严重度句柄三个词、三种互不重叠的行为（对齐 eve）：

- `.gate(x?)` —— 升级为硬要求。省略 `x` 用默认通过线 1；打分断言可给 `x` 指定硬阈值。
- `.atLeast(x)` —— 降级为带通过线的 soft。`x` 是**分数线**：0/1 断言写 `.atLeast(1)`（挂了照实记 failed，`--strict` 才拖垮 Verdict），打分断言写 `.atLeast(0.7)`。
- `.soft()` —— 降级为纯记录的 soft，不设线（judge 的默认严重度就是它）。**无参数**——要设线用 `.atLeast(x)`，不提供同义的 `soft(x)`。

`.atLeast` 的参数是分数线，不是调用次数——「至少调用 n 次」在匹配条件的 `count` 里表达（数字恰好、谓词自定，见[作用域断言](../library/scoped-assertions.md#匹配条件的字段全集)）。

severity 只管**判定面**：它声明一条断言的失败怎么向上传播，同一语义沿组、eval、experiment 逐层作用，不按层另设规则，`--strict` 是作用于所有层的同一个旋钮——它把带线 soft 翻成 gate，只改判定传播，分数照记。质量分（soft 断言的均值）与分数面（计分制的给分）是另外两个读数，折叠规则见[计分粒度](../../experiments/score-points.md)。

## 计分制里的 `.gate()`：前置中止

上面三个词描述的是通过制（`defineEval`）的 `t`。计分制（`defineScoreEval`）的 `t` 是另一套类型，句柄上的词各有各的定义：

- **`.gate(x?)` = 前置**。挂了**就地结束 `test()`**，后面的给分代码不执行；它是计分制里 `failed` 的唯一来源。与通过制的 gate 不同：通过制的 gate 不中止执行（继续收集其余断言作为诊断证据），把 verdict 翻成 failed；计分制不需要「翻 verdict」这一层——丢分已经由分数表达——需要的是「后面跑了也白跑，别浪费沙箱时间」。
- **`.points(n)` = 得分点**，不参与判定、不进质量分；链过 `.points()` 的句柄上只剩 `.gate()` 与 `.optional()`。
- **`.atLeast(x)` 只是观测的通过线**：低于线如实记 failed，**永不影响判定**——在通过制它还兼着「`--strict` 下翻成 gate」，那半边在计分制不存在。
- **不链词就是观测**：进质量分、不参与判定；matcher 的通过线照常生效，没做到如实记 `failed`。显式 `.soft()` 再把线也去掉（纯记录一个分数、永不 failed）。
- **没有 `--strict`**：判定面只认前置中止，带线的观测在任何模式下都不翻 verdict。计分制实验上传这个 flag 是启动期用法错误，见[计分粒度](../../experiments/score-points.md#计分制叠加给分没有上限声明)。

前置断言在**写下的位置立即求值**（普通断言延迟到收尾才求值）——之后发生的事不改变它的结论，这正是「前置」的含义。matcher 自带或链上的严重度在计分制只贡献通过线，不使一条断言成为前置：前置是题目结构的声明，必须写在断言句柄上。完整的角色表见[计分粒度](../../experiments/score-points.md#计分制叠加给分没有上限声明)。

## Verdict

Verdict 只有 passed、failed、errored、skipped，按固定优先级取第一个成立项：

```text
执行异常、超时、作者错误，或任一非 optional 断言 unavailable   → errored
任一 gate 不通过，或 strict 下任一 soft 不通过                 → failed
显式 t.skip(reason)                                            → skipped
否则                                                           → passed
```

Errored 压过一切，因为执行证据已经不可信。Failed 压过 skipped，避免 `t.skip()` 掩盖此前记录的硬失败。

计分制（`defineScoreEval`）用同一张表，只是 `failed` 那一行换成**前置 `.gate()` 中止**——得分点丢分不产生 failed。所以计分制的 verdict 回答的是「这次的分数完不完整」：跑完了是 `passed`（哪怕只挣 1 分），断在前置是 `failed`，评不了是 `errored`（分数 `null`）。「做到几成」由分数面回答，不借判定面表达。

## 证据不可用（unavailable）不折叠成通过

一条断言评不了和它通过、失败都是两回事。以下情况把该条 `AssertionResult` 记为 `outcome: "unavailable"`（带机器可读 `reason`），绝不静默丢弃、绝不按空证据判通过：

- **负断言与上限断言的证据通道不完整**——`notEvent` / `usedNoTools` 这类「确认没发生」的断言，以及 token / cost 上限断言，依赖完整采集；所需通道非 complete 时（含 unknown，见[证据与完整性](evidence.md)），空流不能证明「没发生」，缺 usage 不能按零聚合。
- **正断言在非 complete 通道上没找到匹配**——「没采到」不能算成「Agent 没做」；找到匹配则照常通过（证据存在就是证据），complete 通道上没找到才是 failed。
- **judge 没有解析到模型或 API key**——rubric 写了就必须留下记录（见 [LLM-as-judge](../library/judge.md)）。
- **judge 调用没有产出可信分数**——请求发出去了但失败（HTTP 非 2xx、连接中断、单次调用超时），或响应回来了但取不出分数（不合协议、分数缺失或不可解析）。判分请求失败与 agent 没做到在分数面上必须可分辨：**这种情况绝不落成 `score: 0` 的通过记录**，否则「裁判挂了」和「答得一塌糊涂」在报告里长得一模一样，而前者是要修配置、后者是要修 agent。`reason` 用 `judge-call-failed`，状态码或异常摘要进 `evidence`。

折叠规则只有一条：**作者写下的每条断言默认都要求可评估**——任一非 optional 断言 unavailable，attempt 即 `errored`，不分 gate / soft。评不了的结论不可信，不能当 agent 答对，也不该当 agent 答错；「soft 全部评不了但 attempt 还绿着」是没有测量的绿，不允许出现。确实允许缺席的断言由作者显式链 `.optional()`——它的 unavailable 只保留在记录里由报告如实展示，不影响 Verdict。optional 与 severity 正交：severity 说「影不影响质量判定」，optional 说「证据允许不允许缺席」，不互相复用。

Turn failed 和 attempt errored 不是同一概念：Agent 行为失败可以形成可评分结果；基础设施、超时或作者异常使本次执行无法形成可信结论。
