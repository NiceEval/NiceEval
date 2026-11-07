# 设计裁决:计分制给分证据在有源码的 attempt 详情由源码面承载

- **裁决**(2026-07-23):「计分制 + 有源码」的 attempt 详情里,给分证据由 `AttemptSource` 自己承载——得分点挣分进源码行右缘 pill、`t.score(...)` 调用行原位标注给分、前置中止行标 `⤓` 且其后源码行降灰(未到达区),`loc` 不在展示源码内的得分点与给分记录落既有 unmapped 区。配套裁决:本轮挣分总分只在 `AttemptSummary` 头行出现一次;得分点(含 passed)豁免 passed 收纳;计分制 passed 有丢分时结果摘要取首条丢分得分点(`+N more lost points`);`AttemptFixPrompt` 把丢分算可操作失败。落点:`docs/feature/scoring/library/display.md`、`docs/feature/reports/library/attempt-detail.md`、`docs/feature/reports/show/attempt.md`、`docs/feature/reports/library/entity-lists.md`。
- **曾选方案**:`AttemptAssessment` 在计分制下于 `AttemptSource` 之外追加独立「给分记录」区块(source 与 assertions 并存)。
- **否决理由**:与「源码即报告」的默认形态相抵——给分点本来就有 `loc`,原位标注让「哪行代码挣了几分」零跳转可读;追加区块则把同一批断言的分数面和源码面拆到两个区块,重复 `AttemptAssessment` 二选一规则试图消灭的那种双视角冗余。unmapped 区已经是断言的既有兜底,给分记录走同一条路不添新概念。
- **背景**:此前 `display.md` 承诺「show/view 详情都消费 `ScoreEntry[]`」,但组件契约 `AttemptAssessment` 有 source 时二选一选 `AttemptSource`,而 `AttemptSource` 未声明任何给分职责——两篇契约矛盾,真机表现为默认 `show @locator` 页看不到 `t.score` 给分(2026-07-23 发现)。修法是补 `AttemptSource` 的给分契约,不是给 `AttemptAssessment` 加区块。
