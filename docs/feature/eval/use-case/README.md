# Eval 用例

本目录把 `defineEval` 与 `defineScoreEval` 组合成真实场景。基础契约只在
[Library](../library.md)、[Context](../library/context.md)、[Assertions](../../assertions/README.md) 和
[Sandbox](../../sandbox/library.md) 定义。

## 会话驱动

- [单轮：一问一答就断言](first-single-turn.md)
- [多轮与并行会话：每轮各自断言](multi-turn-sessions.md)
- [HITL 审批：agent 停在人工输入上](hitl-approval.md)

## Assertions 与评分项

- [过程与成本：断言 Agent 怎样完成任务](process-and-cost.md)
- [calledTool 匹配：名称、输入、状态与次数](calledtool.md)
- [裁判评质量：规则写不出对错时](judge-quality.md)
- [Score Eval：检查项与质量 measurement](rubric-points.md)

## 通过制还是 Score Eval

`defineEval` 使用 Pass Eval。Boolean mismatch 的 gate 在 Assertion 封口后参与 Core `outcome`、sealed
Assertions 与显式 skip 的 Verdict 读侧折叠；其它 Assertion 继续结算。measurement 在登记后的 handle 上用 `.gate(n)` 形成唯一 condition 并进入 failed。

`defineScoreEval` 使用 Score Eval。每条 Assertion 在 `niceeval.assertions` family 的 persistence revision `3` envelope 内封口 evaluation。
`.score(points)` 和 `t.score(points)` 才将 points 与 earned contribution 加入同一份 sealed facts。Score 从
这些 facts 与 rubric 在读侧形成 complete、partial 或 unavailable。正常没有 contribution 时，earned score
仍为 `0`；低分本身不会成为 `failed`，但显式 gate 不满足时仍得到 `failed` 并保留 earned score。

| 用例 | 推荐形态 |
|---|---|
| 所有条件必须满足 | `defineEval` + Boolean condition |
| 部分完成仍可比较 | `defineScoreEval` + score contribution |
| 开放式质量作为通过条件 | Judge measurement + `.gate(n)` |
| 开放式质量贡献分数 | Judge measurement + `.score(points)` |

## API → 篇目对照

| API | 所在篇目 |
|---|---|
| `t.send` / `t.sendFile` / `t.reply` / `turn.message` / `turn.data` | [单轮](first-single-turn.md) |
| `turn.succeeded` / `turn.input` / `t.newSession()` / `session.*` | [多轮与并行会话](multi-turn-sessions.md) |
| `calledTool` / `notCalledTool` / `toolOrder` / `event` | [过程与成本](process-and-cost.md) · [calledTool 匹配](calledtool.md) |
| `t.check(subject, match)` / `.orStop()` / `niceeval/expect` matcher | [单轮](first-single-turn.md) · [沙箱](sandbox-coding.md) |
| `defineJudge(...)` / `t.judge(material, definition)` / `t.check(material, definition)` | [裁判评质量](judge-quality.md) |
| `.score(points)` / `t.score(points)` | [Score Eval](rubric-points.md) |
| 数组导出 / keyed record 导出 / `loadYaml` / `loadJson` | [测试集](dataset-fanout.md) |
| `t.sandbox.*` | [沙箱 coding 任务](sandbox-coding.md) |

<!-- niceeval.docs-index/v1:start -->
## Use Case 索引（生成）

- [验证 Agent 真的完成了所需操作](calledtool.md)
- [本地测试文件:普通上传与动态身份](criteria-files.md)
- [测试集从输入数组生成多条 eval：一套逻辑跑一批 case](dataset-fanout.md)
- [单轮：一问一答就断言](first-single-turn.md)
- [Fixture 与反馈：prepare 与长步骤报告](fixtures-lifecycle.md)
- [HITL 审批：agent 停在人工输入上](hitl-approval.md)
- [裁判评质量：规则写不出对错时](judge-quality.md)
- [多轮与并行会话：每轮各自断，跨轮显式评](multi-turn-sessions.md)
- [过程与成本：断 agent 怎么做到的](process-and-cost.md)
- [计分制：检查点和质量分](rubric-points.md)
- [沙箱 coding 任务：从放文件到评 diff](sandbox-coding.md)
- [比较同一接口的应用实现](比较应用实现.md)
- [评估应用原生操作](评估应用原生操作.md)
<!-- niceeval.docs-index/v1:end -->
