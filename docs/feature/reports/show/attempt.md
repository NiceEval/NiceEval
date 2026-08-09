# 单 Attempt 默认详情

范围恰好命中一个 Attempt 且没有显式切片时，`show` 调用 `attemptDetailsResult(attempt)`，再用 Attempt 详情的 text 面显示结果。
同一 Result 也供 `--json` 使用。

## 默认顺序

1. locator、Experiment、Eval、Attempt 与 verdict。
2. 开始时间、耗时、成本、得分与 usage。
3. facts：`ctx.fact()` 上报的运行事实完整键值表，有才显示。
4. 结构化 error 与 persisted diagnostics。
5. 标注 Eval 源码；源码不可用时显示 Fact result/use 表。
6. 生命周期 timing。
7. 对话、trace 与 diff 的紧凑摘要。

每类证据各自决定是否有内容。
缺失时整块省略或显示明确缺失，不留下空标题，也不猜一个零值。

顶部 text 摘要的耗时与执行时间轴使用同一 `formatDurationMs` 口径；例如落盘值
`254334ms` 显示为 `@1qrdcfq8 · passed · 4m 14s`，不会把原始毫秒直接拼进用户输出。

## Usage

`usageResult(attempt)` 是详情、`--usage` 与 JSON 的共同结果。
轮数与工具调用数来自标准事件流；token 与请求计数来自落盘 Usage；成本来自相同 Attempt 事实。

缓存拆分存在时，输入 token 区分 uncached input 与 cache read。
协议没有拆分事实时只显示 input tokens。

```text
usage: 6 turns · 21 tool calls · 62.3k uncached in
       + 942.6k cache read / 6.7k out · 24 requests · $1.14
```

某段事实缺失时对应片段整段省略；全部缺失时 usage 行不出现。

## Facts

`factsResult(attempt)` 是详情与 JSON 的共同结果，把 `AttemptRecord.facts`（[运行时观测](../../record/architecture.md#facts运行事实)）投影成完整键值表——facts 是开放键集合，不像 Usage 有固定小字段，因此渲染整张表而不是压成一行摘要。

```text
facts:
  memory.notesLoaded       73
  nowledge.endpoint        https://tunnel.example
```

没有 `ctx.fact()` 上报过任何事实时整块省略，不摆空表。
按落盘 key 的插入顺序显示，不重新排序。
组装口径单源见 [Attempt Facts](../components/attempt-detail/attempt-facts.md)。

## Fact/use 与源码

有 Eval 源码时，`toAttemptSource(attempt)` 返回标注源码；否则详情返回 Fact result/use rows。两条路径使用同一份 producer/consumer 源码锚。

失败或不可用 use 按 `sourceOrder` 显示，并保留 label、Fact 名、expected、received、reason 与位置。成功 ScoreFact 显示归一化分数；score use 显示实际 earned 分。Judge 只作为一个 ScoreFact producer 出现在该通用表中。

## 错误与 diagnostics

`toAttemptNotices(attempt)` 把结构化 error 和 diagnostics 转成 Callout items。
error phase、diagnostic phase 与 timing 使用同一套 LifecyclePhase 名字。
未知 diagnostic code 保留原始 detail，不猜 action。

diagnostic level 不等于 verdict。
passed 或 failed Attempt 也可以带 cleanup warning。

## Timing

`toTimelineNodes(attempt)` 返回主链阶段与子节点。
紧凑首页保留每个存在的 LifecyclePhase，并折叠子节点；`--timing` 显示同一结果的完整 text 投影。

没有 phases 时整块省略，不从总耗时猜阶段。

## 显式切片

- [`--source`](eval-source.md) —— 完整标注源码或单文件。
- [`--execution`](execution.md) —— 对话与工具调用。
- [`--timing`](timing.md) —— 生命周期阶段与 spans。
- [`--usage`](usage.md) —— 范围内用量表。
- [`--diff`](diff.md) —— 文件差异。

这些切片各调用一个公开任务函数，不从 AttemptDetails 组件树切数据。

## 自定义报告

项目配置的默认报告不接管 `show @<locator>`；这条命令始终提供官方诊断首页，与 `--source`、`--execution`、`--timing`、`--usage`、`--diff` 组成稳定的证据读取面。

只有显式带 `--report <file>` 时，单 Attempt 范围才进入该报告的 `attempt` page。报告没有这张参数化页时命令报错；显式选择报告意味着要求它负责呈现，宿主不静默换回官方详情。

## 相关阅读

- [`AttemptDetails`](../components/attempt-detail/README.md)
- [show](../show.md)
- [ShowJson](json.md)
