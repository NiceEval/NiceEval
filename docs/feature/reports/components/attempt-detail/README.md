# Attempt 详情

Attempt 详情是一张 page，不是 `ReportDefinition` 的第二个内容槽。它和其它 page 一样只有 `id`、
标题、输入声明与一棵 `content: ReportNode`。`input: "attempt"` 表示宿主必须先用 locator 装配一份
[`AttemptEvidence`](../../../record/library.md)；`navigation: false` 表示它没有 locator 时不进入导航。

```tsx
import { AttemptDetail, defineReport } from "niceeval/report";

export default defineReport({
  pages: [
    { id: "report", title: "Report", content: <SampleOverview /> },
    {
      id: "attempt",
      title: "Attempt",
      input: "attempt",
      navigation: false,
      content: <AttemptDetail />,
    },
  ],
});
```

`AttemptDetail` 与 `SampleOverview` 同级：二者都是用公开叶子组件写成的普通组合组件，不拥有 page、路由或宿主特权。

**详情的弹窗形态属于宿主摆放，不是一个组件。** `view` 为每个可达 locator 物化一份完整静态文档，
基线链接直接打开它。增强脚本可以拦截链接、把同一份 web 输出放进 dialog；dialog 内部的区块、
顺序、样式和取舍仍全部来自这张 page 的 content。

报告库里没有「弹窗组件」可配置。要改弹窗里有什么，就改这张 page 的组件树；要改它怎么被打开，
那是 [`view` 的机器](../../architecture.md#宿主保留的只有机器)。

## 公开区块集

[`AttemptDetail`](attempt-detail.md)、[`AttemptAssessment`](attempt-assessment.md)、
[`AttemptNotices`](attempt-notices.md) 与 [`AttemptFixPrompt`](attempt-fix-prompt.md) 是组合组件；
[`AttemptSummary`](attempt-summary.md) / [`AttemptUsage`](attempt-usage.md) 是消费 AttemptSnapshot
的 Component。只有中性事实投影留在 `sources.attempt`。

| 数据源 | 原语 | 只负责什么 | 空证据 |
|---|---|---|---|
| `sources.attempt.snapshot` | `AttemptSummary` / `AttemptUsage` | 身份、verdict、挣分、时间、用量、成本与 error 事实 | 恒有 |
| `sources.attempt.assertions` | `Table` | assertion 与给分记录 | 无记录时 `null` |
| [`sources.attempt.source`](../sources/attempt-source.md) | `SourceView` | 带标注源码、回复、断言与给分证据 | 无 source 时 `null` |
| `sources.attempt.timeline` | `Waterfall` | runner phases 与关联 spans | 无 phase 时 `null` |
| `sources.attempt.conversation` | `Conversation` | 分轮事件流与失败命令卡 | 无事件与命令时 `null` |
| `sources.attempt.diagnostics` | `AttemptNotices` | 已持久化的 lifecycle diagnostics | 无 diagnostics 时 `null` |
| `sources.attempt.trace` | `Waterfall` | 原始 OTel span 树 | 无 trace 时 `null` |
| `sources.attempt.diff` | `DiffView` | 文件摘要与 patch | 无变更时 `null` |

`AttemptConversationContent` 在分轮卡片之外携带 `failedCommands`。它是
[`commands.json`](../../../record/architecture.md#commandsjson) 的投影，包含关联时间树的
`timingNodeId`，并按 timing `startOffsetMs` 排序。`--execution` 的失败命令卡、`cmd<N>` 句柄与
`--json` 的结构化输出都消费这一字段；终端呈现细则见 [`--execution`](../../show/execution.md)。
没有失败命令时字段省略，不摆空数组。

区块按事实边界拆分，不按某个宿主当前的卡片拆分。`sources.attempt.timeline` 把 span 按显式
correlation 挂回 runner 时间树；`sources.attempt.trace` 保留原始 OTel 视角。默认 `AttemptDetail`
只放 timeline 一张——trace 的内容已嵌在其中，同页摆两张是同一批 span 平铺两遍。trace
供作者显式放置，用于核对采集侧原始层级（如调 telemetry 接入时）。

`sources.attempt.source` 与 `sources.attempt.assertions` 会呈现同一批 assertion 的不同视角。
默认组合通过 `AttemptAssessment` 二选一，避免重复。前者还把标准事件流按 `loc` 投影回 send 行，
点击行可在源码上下文中展开回复。因此默认 `AttemptDetail` 有 source 时不追加独立 conversation，
没有 source 时才用 `sources.attempt.conversation` 作为完整事件流 fallback。作者仍可显式同时放置两者。

按 `loc` 投影盖不住的事实不丢弃。其它项目文件进入源码调用树的调用片段或 detached block，越界行与
缺少正文的项目帧显示 unavailable 缺口。只有没有 `loc` 的断言与给分记录进入「Other assertions」，
逐条平铺，判定语义与 `sources.attempt.assertions` 一致。

「Other conversation」收没有 `loc` 的轮次。有 source 时页面不放独立 `sources.attempt.conversation`，这个
兜底区是无位置轮次在页面上唯一的出现处。它按 `sources.attempt.conversation` 同形态呈现：分轮卡片带轮标签
与状态，内部 user / assistant / thinking / tool / error 条目复用同一套回复渲染。工具出入参的单行
预览在字符串化之前收口自由文本；结构化值先逐字段收口再 `JSON.stringify`。

## page 输入与数据源

attempt-input page 的 resolve context 是判别联合的一支：

```ts
type PageContext =
  | { id: string; input: "sample" }
  | {
      id: string;
      input: "attempt";
      locator: AttemptLocator;
      evidence: AttemptEvidence;
    };
```

每个数据源只接受 `AttemptEvidence`，不接受 Sample：

```ts
interface AttemptSources {
  snapshot: Source<AttemptEvidence, AttemptSnapshot>;
  assertions: Source<AttemptEvidence, TableContent | null>;
  source: Source<AttemptEvidence, SourceContent | null>;
  timeline: Source<AttemptEvidence, WaterfallContent | null>;
  conversation: Source<AttemptEvidence, ConversationContent | null>;
  diagnostics: Source<AttemptEvidence, readonly DiagnosticRecord[] | null>;
  trace: Source<AttemptEvidence, WaterfallContent | null>;
  diff: Source<AttemptEvidence, DiffContent | null>;
}
```

`null` 在两个面都渲染为空。`loadAttemptEvidence` 已经完成一次性装配，数据源只做适合展示与
序列化的派生。原语 source 形态省略 `input` 时取当前 attempt-input page 注入的 evidence；
放在 sample-input page 时必须显式传 `input`。

## Snapshot 的阅读组件

[`AttemptSummary`](attempt-summary.md) 与 [`AttemptUsage`](attempt-usage.md) 都是普通 Component，
接受同一个 `sources.attempt.snapshot`；page resolve 会复用这次计算。
[`AttemptNotices`](attempt-notices.md) 是组合组件，把 snapshot 中的 error 与 persisted
diagnostics 一起分类。[`AttemptFixPrompt`](attempt-fix-prompt.md) 在组合层从 snapshot、
assertions、conversation 与 diff 选择可行动证据。

```tsx
<AttemptSummary source={sources.attempt.snapshot} />
<AttemptUsage source={sources.attempt.snapshot} />
```

## 在 `show` 与 `view` 怎样渲染

两个宿主先选中同一张 attempt-input page，再用 locator 得到同一份 `AttemptEvidence`，并 resolve
其 content；区别只在最后一个 face：

| 组件 | `show @locator --report ...` 的 text 面 | `view` 的 web 面 |
|---|---|---|
| `AttemptSummary` | 紧凑身份与 verdict 摘要（计分制含本轮挣分） | 详情标题、状态和统计卡（计分制含本轮挣分） |
| `AttemptNotices` / `sources.attempt.assertions` | error、diagnostics 与未通过项列表 | 可展开的完整结构化细节 |
| `sources.attempt.source` | 未通过 assertion 的源码位置与 expected / received，加 `--source` 命令；含轮次时同时保留 `--execution` 下钻入口，不倾倒整份源码；计分制同时列得分点挣分与给分记录 | TypeScript 语法高亮的完整源码；send / pass / gate-fail / soft-fail 行分别着色，可点击展开该轮回复或 assertion 细节；计分制附挣分 pill、给分行标注与中止后降灰 |
| `AttemptFixPrompt` | 零输出；终端已有可直接交给 agent 的 evidence 命令 | 单条失败的复制按钮与完整 prompt |
| `sources.attempt.timeline` | phase 摘要与 `--timing` 命令 | 可逐层展开的 runner + correlated spans 时间树 |
| `sources.attempt.conversation` | 轮次摘要与 `--execution` 命令 | 完整分轮事件卡 |
| `AttemptUsage` | 单行 `usage:` 摘要 | 同一 snapshot usage 的数值表 |
| `sources.attempt.trace` | span 摘要与 `--timing` 命令 | 原始 span 瀑布与树 |
| `sources.attempt.diff` | 文件摘要与 `--diff` 命令 | 文件列表与可展开 patch |

text 面允许把有稳定 CLI 选择器的大块内容折成摘要加命令，但不能改变判定、计数、可用性或引用。
专用 `--source` / `--execution` / `--timing` / `--diff` 仍是 Record evidence 的深度终端投影，
不是另一套组件数据。

`show @<locator>` 是「选择报告中唯一的 attempt-input page + 传 locator」的快捷语法。
不带 `--report` 时选择内建 `standard` 里的那张 page。

## 相关阅读

- [详情的呈现](presentation.md) —— 逐块的字段、形态与 DOM 骨架。
- [组件树](../README.md) —— 这一族为什么不收结构子节点。
- [`sources.attempt.source`](../sources/attempt-source.md) —— web 面视觉规范。
- [`AttemptUsage`](attempt-usage.md) —— snapshot usage 的双面呈现。
- [`AttemptAssessment`](attempt-assessment.md) / [`AttemptDetail`](attempt-detail.md) —— 两个组合组件。
- [外壳与多页](../../library/shell.md) —— 参数化 page 的字段与校验。
- [排版原语与自定义组件](../../library/layout.md) —— page context 与组合组件协议。
- [内建报告](../../library/built-in.md) —— `standard` 的四张 page 全文。
- [Architecture](../../architecture.md) —— 单一 page 模型与宿主机器边界。
