# Attempt 详情

Attempt 详情是一张 page，不是 `ReportDefinition` 的第二个内容槽。它和其它 page 一样只有 `id`、标题、输入声明与一棵 `content: ReportNode`；区别只是 `input: "attempt"` 表示宿主必须先用 locator 装配一份 [`AttemptEvidence`](../../../record/library.md)，`navigation: false` 表示它没有 locator 时不进入导航。

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

**详情的弹窗形态属于宿主摆放，不是一个组件。** `view` 为每个可达 locator 物化一份完整静态文档，基线链接直接打开它；增强脚本可以拦截链接、把同一份 web 输出放进 dialog，但 dialog 内部的区块、顺序、样式和取舍全部来自这张 page 的 content。因此报告库里没有「弹窗组件」可配置——要改弹窗里有什么，改的是这张 page 的组件树；要改它怎么被打开，那是 [`view` 的机器](../../architecture.md#宿主保留的只有机器)。

## 公开区块集

[`AttemptDetail`](attempt-detail.md) 与 [`AttemptAssessment`](attempt-assessment.md) 是组合组件。其余公开
对象都是数据源；它们把 `AttemptEvidence` 投影成已有原语可消费的 Content，不再为每个证据位创建
一个 PascalCase renderer。

| 数据源 | 原语 | 只负责什么 | 空证据 |
|---|---|---|---|
| `attemptSummary` | `Grid` | 身份、verdict、挣分、时间、成本与证据能力位 | 恒有 |
| `attemptError` | `Callouts` | 结构化 error、cause 与基础设施失败信息 | 无 error 时 `null` |
| `attemptAssertions` | `Table` | assertion 与给分记录 | 无记录时 `null` |
| [`attemptSource`](attempt-source.md) | `SourceView` | 带标注源码、回复、断言与给分证据 | 无 source 时 `null` |
| `attemptFixPrompt` | `CopyBlock` | 单条失败的修复 prompt | 无可操作失败时 `null` |
| `attemptTimeline` | `Waterfall` | runner phases 与关联 spans | 无 phase 时 `null` |
| `attemptConversation` | `Conversation` | 分轮事件流与失败命令卡 | 无事件与命令时 `null` |
| `attemptDiagnostics` | `Callouts` | lifecycle diagnostics | 无 diagnostics 时 `null` |
| [`attemptUsage`](usage-table.md) | `Grid` | 轮数、工具调用、token 与成本 | 无 usage 时 `null` |
| `attemptTrace` | `Waterfall` | 原始 OTel span 树 | 无 trace 时 `null` |
| `attemptDiff` | `DiffView` | 文件摘要与 patch | 无变更时 `null` |

`AttemptConversationContent` 在分轮卡片之外携带 `failedCommands`——[`commands.json`](../../../record/architecture.md#commandsjson) 的投影(含关联时间树的 `timingNodeId`,按 timing `startOffsetMs` 排序);`--execution` 的失败命令卡、`cmd<N>` 句柄与 `--json` 的结构化输出消费的都是这一份字段,终端呈现细则见 [`--execution`](../../show/execution.md)。没有失败命令时字段省略,不摆空数组。

区块按事实边界拆分，不按某个宿主当前的卡片拆分。`attemptTimeline` 可以把 span 按显式 correlation 挂回 runner 时间树；`attemptTrace` 则保留原始 OTel 视角，因此二者可以择一，也可以同时放。`attemptSource` 与 `attemptAssertions` 会呈现同一批 assertion 的不同视角，默认组合通过 `AttemptAssessment` 二选一，避免重复。`attemptSource` 还把标准事件流按 `loc` 投影回 send 行，点击行可在源码上下文中展开回复；因此默认 `AttemptDetail` 有 source 时不再追加独立 `attemptConversation`，没有 source 时才把它作为完整事件流 fallback。报告作者仍可显式同时放置两者，此时两种视角并存是作者选择。

按 `loc` 投影盖不住的事实不丢弃。其它项目文件进入源码调用树的调用片段或 detached block，越界行与
缺少正文的项目帧显示 unavailable 缺口。只有没有 `loc` 的断言与给分记录进入「Other assertions」，
逐条平铺，判定语义与 `attemptAssertions` 一致。

「Other conversation」收没有 `loc` 的轮次。有 source 时页面不放独立 `attemptConversation`，这个
兜底区是无位置轮次在页面上唯一的出现处。它按 `attemptConversation` 同形态呈现：分轮卡片带轮标签
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
declare const attemptSummary: DataSource<AttemptSummaryContent, AttemptEvidence>;
declare const attemptError: DataSource<CalloutsContent | null, AttemptEvidence>;
declare const attemptAssertions: DataSource<TableContent | null, AttemptEvidence>;
declare const attemptSource: DataSource<SourceContent | null, AttemptEvidence>;
declare const attemptFixPrompt: DataSource<CopyBlockContent | null, AttemptEvidence>;
declare const attemptTimeline: DataSource<WaterfallContent | null, AttemptEvidence>;
declare const attemptConversation: DataSource<ConversationContent | null, AttemptEvidence>;
declare const attemptDiagnostics: DataSource<CalloutsContent | null, AttemptEvidence>;
declare const attemptUsage: DataSource<AttemptUsageContent | null, AttemptEvidence>;
declare const attemptTrace: DataSource<WaterfallContent | null, AttemptEvidence>;
declare const attemptDiff: DataSource<DiffContent | null, AttemptEvidence>;
```

`null` 在两个面都渲染为空。`loadAttemptEvidence` 已经完成一次性装配，数据源只做适合展示与
序列化的派生。原语 source 形态省略 `input` 时取当前 attempt-input page 注入的 evidence；
放在 sample-input page 时必须显式传 `input`。

## 在 `show` 与 `view` 怎样渲染

两个宿主先选中同一张 attempt-input page，再用 locator 得到同一份 `AttemptEvidence` 并 resolve 其 content；区别只在最后一个 face：

| 组件 | `show @locator --report ...` 的 text 面 | `view` 的 web 面 |
|---|---|---|
| `attemptSummary` | 紧凑身份与 verdict 摘要（计分制含本轮挣分） | 详情标题、状态和统计卡（计分制含本轮挣分） |
| `attemptError` / `attemptAssertions` | 有界错误与未通过项列表;不带专属命令(完整 locator 已在 `attemptSummary` 那一行) | 可展开的完整结构化细节 |
| `attemptSource` | 未通过 assertion 的源码位置与 expected / received，加 `--source` 命令；含轮次时同时保留 `--execution` 下钻入口，不倾倒整份源码；计分制同时列得分点挣分与给分记录 | TypeScript 语法高亮的完整源码；send / pass / gate-fail / soft-fail 行分别着色，可点击展开该轮回复或 assertion 细节；计分制附挣分 pill、给分行标注与中止后降灰 |
| `attemptFixPrompt` | 零输出；终端已有可直接交给 agent 的 evidence 命令 | 单条失败的复制按钮与完整 prompt |
| `attemptTimeline` | phase 摘要与 `--timing` 命令 | 可逐层展开的 runner + correlated spans 时间树 |
| `attemptConversation` | 轮次摘要与 `--execution` 命令 | 完整分轮事件卡 |
| `attemptDiagnostics` | 紧凑分组列表 | 分组 details |
| `attemptUsage` | 单行 `usage:` 摘要（组装口径见 [`attemptUsage` 组装口径（单源）](usage-table.md#组装口径单源)） | 同一口径的数值表 |
| `attemptTrace` | span 摘要与 `--timing` 命令 | 原始 span 瀑布与树 |
| `attemptDiff` | 文件摘要与 `--diff` 命令 | 文件列表与可展开 patch |

text 面允许把有稳定 CLI 选择器的大块内容折成摘要加命令，但不能改变判定、计数、可用性或引用；专用 `--source` / `--execution` / `--timing` / `--diff` 仍是 Record evidence 的深度终端投影，不是另一套组件数据。

`show @<locator>` 是「选择报告中唯一的 attempt-input page + 传 locator」的快捷语法；不带 `--report` 时选择内建 `standard` 里的那张 page。

## 相关阅读

- [组件树](../README.md) —— 这一族为什么不收结构子节点。
- [`attemptSource`](attempt-source.md) —— web 面视觉规范。
- [`attemptUsage`](usage-table.md) —— 用量组装口径（单源）。
- [`AttemptAssessment`](attempt-assessment.md) / [`AttemptDetail`](attempt-detail.md) —— 两个组合组件。
- [外壳与多页](../../library/shell.md) —— 参数化 page 的字段与校验。
- [排版原语与自定义组件](../../library/layout.md) —— page context 与组合组件协议。
- [内建报告](../../library/built-in.md) —— `standard` 的四张 page 全文。
- [Architecture](../../architecture.md) —— 单一 page 模型与宿主机器边界。
