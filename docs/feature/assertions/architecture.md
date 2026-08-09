# Assertions —— 架构

Assertion 是一次 Attempt 内的检查结果。值 matcher、作用域检查、Sandbox 检查、资源限制和 Judge 都把各自的业务数据写入 Attempt-owned <code>niceeval.assertions</code> channel。

Assertion 不拥有 Run membership、Attempt origin 或报告聚合。它只说明某项检查检查了什么、得到什么状态、采用哪些材料，以及该项是 gate、soft 还是 optional。

~~~text
value / scope / judge / sandbox / efficiency
                    ↓
            Assertion collector
                    ↓
    Attempt channel: niceeval.assertions
                    ↓
              Verdict folding
~~~

## 断言条目

<code>niceeval.assertions</code> 保存按声明顺序排列的 <code>AssertionResult</code>。每条使用以下稳定字段：

| 字段 | 说明 |
|---|---|
| <code>name</code>、<code>groupPath</code>、<code>source</code> | 条目名称、展示分组和可选源码位置。 |
| <code>severity</code>、<code>optional</code>、<code>stopOnFailure</code> | 对 Verdict 和用户测试流程的影响。 |
| <code>outcome</code> | <code>passed</code>、<code>failed</code> 或 <code>unavailable</code>。 |
| <code>score</code>、<code>threshold</code> | 有分数条目的归一化得分和通过线。 |
| <code>expected</code>、<code>received</code>、<code>evidence</code> | 有界的人读预览。 |
| <code>reason</code> | 仅 <code>unavailable</code> 的机器可读原因。 |
| <code>pointsAvailable</code>、<code>points</code> | 计分制 Eval 的可得分与实得分。 |

<code>expected</code>、<code>received</code> 和 <code>evidence</code> 是有界预览。完整的源码、diff、conversation 和大文本由各自 channel 或 Attempt-owned blob 保存；断言条目只保存判定和展示需要的摘要。

<code>groupPath</code> 仅组织呈现与分数汇总。它不改变 Verdict。<code>stopOnFailure</code> 只决定失败后是否继续执行用户的 <code>test()</code>，也不改变严重度。

## 判定与分数

<code>severity: "gate"</code> 的 <code>failed</code> 参与失败 Verdict。<code>severity: "soft"</code> 只在 strict policy 下参与失败 Verdict。<code>optional</code> 只改变 <code>unavailable</code> 对 Verdict 的影响，不把它改成通过。

<code>score</code> 是本条检查的归一化得分。<code>pointsAvailable</code> 与 <code>points</code> 只属于计分制 Eval；它们不从 score 反推，也不改变通过制 Eval 的规则。

<code>t.score(label, points)</code> 写入独立的分数条目。它不含 severity 或 outcome，不能直接改变 Verdict。

## 数据归属

Assertion collector 只消费调用方提供的值和已经交付的通道数据。它不打开 Record 路径，不读 ReportInput，也不生成报告页面。

source 位置信息可选。存在时，它只含项目相对路径、行列和调用路径；第三方包不写入项目源码内容。

通道文件由 Attempt owner 写入。人工编辑停稳 Record 后，下一次 reader、Sample 和 Report 会看到新的 Assertion 数据。

## 与 Verdict 和 Reports 的关系

Verdict 从 assertion 条目、执行错误和 strict policy 形成 <code>niceeval.verdict</code>。Verdict 规则由 [Verdict](../verdict/architecture.md) 单点定义。

Sample 只保留 Attempt 核心和分母，不读取 assertion。ReportPlan 声明 assertion requirement 后，composition adapter 才把对应 <code>ChannelRead</code> 放进内部 ReportInput；Report 不能自行读取 assertion 文件或重新计算 Attempt 业务状态。

## 相关阅读

- [Assertion 证据与完整性](architecture/evidence.md)
- [Assertion 展示](library/display.md)
- [Assertion Library](library.md)
- [Verdict](../verdict/README.md)
- [Record 通道](../record/architecture.md#通道语义与兼容性)
