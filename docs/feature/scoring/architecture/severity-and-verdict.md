# Severity 与 Verdict

## Severity

- **gate**：硬要求，不通过即 failed。
- **soft**：质量分；无阈值时只记录，带 `.atLeast(x)` 时仅在 strict 模式下影响 Verdict。

`.gate()` 使用 matcher 默认通过线，`.gate(x)` 指定硬阈值；`.atLeast(x)` 始终是 soft threshold。

## Verdict

Verdict 只有 passed、failed、errored、skipped，按固定优先级取第一个成立项：

```text
执行异常、超时、作者错误，或任一非 optional 断言 unavailable   → errored
任一 gate 不通过，或 strict 下 soft 低于阈值                   → failed
显式 t.skip(reason)                                            → skipped
否则                                                           → passed
```

Errored 压过一切，因为执行证据已经不可信。Failed 压过 skipped，避免 `t.skip()` 掩盖此前记录的硬失败。

## 证据不可用（unavailable）不折叠成通过

一条断言评不了和它通过、失败都是两回事。以下情况把该条 `AssertionResult` 记为 `outcome: "unavailable"`（带机器可读 `reason`），绝不静默丢弃、绝不按空证据判通过：

- **负断言与上限断言的证据通道不完整**——`notEvent` / `usedNoTools` 这类「确认没发生」的断言，以及 token / cost 上限断言，依赖完整采集；所需通道非 complete 时（含 unknown，见[证据与完整性](evidence.md)），空流不能证明「没发生」，缺 usage 不能按零聚合。
- **正断言在非 complete 通道上没找到匹配**——「没采到」不能算成「Agent 没做」；找到匹配则照常通过（证据存在就是证据），complete 通道上没找到才是 failed。
- **judge 没有解析到模型或 API key**——rubric 写了就必须留下记录（见 [LLM-as-judge](../library/judge.md)）。

折叠规则只有一条：**作者写下的每条断言默认都要求可评估**——任一非 optional 断言 unavailable，attempt 即 `errored`，不分 gate / soft。评不了的结论不可信，不能当 agent 答对，也不该当 agent 答错；「soft 全部评不了但 attempt 还绿着」是没有测量的绿，不允许出现。确实允许缺席的断言由作者显式链 `.optional()`——它的 unavailable 只保留在记录里由报告如实展示，不影响 Verdict。optional 与 severity 正交：severity 说「影不影响质量判定」，optional 说「证据允许不允许缺席」，不互相复用。

Turn failed 和 attempt errored 不是同一概念：Agent 行为失败可以形成可评分结果；基础设施、超时或作者异常使本次执行无法形成可信结论。
