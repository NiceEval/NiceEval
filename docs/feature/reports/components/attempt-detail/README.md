# Attempt 详情

Attempt 详情是一张 page，不是 `ReportDefinition` 的第二个内容槽。它和其它 page 一样只有 `id`、标题、输入声明与一棵 `content: ReportNode`；区别只是 `input: "attempt"` 表示宿主必须先用 locator 装配一份 [`AttemptEvidence`](../../../record/library.md)，`navigation: false` 表示它没有 locator 时不进入导航。

```tsx
import { AttemptDetail, defineReport } from "niceeval/report";

export default defineReport({
  pages: [
    { id: "report", title: "Report", content: <ExperimentComparison /> },
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

`AttemptDetail` 与 `ExperimentComparison` 同级：二者都是用公开叶子组件写成的普通组合组件，不拥有 page、路由或宿主特权。

**详情的弹窗形态属于宿主摆放，不是一个组件。** `view` 为每个可达 locator 物化一份完整静态文档，基线链接直接打开它；增强脚本可以拦截链接、把同一份 web 输出放进 dialog，但 dialog 内部的区块、顺序、样式和取舍全部来自这张 page 的 content。因此报告库里没有「弹窗组件」可配置——要改弹窗里有什么，改的是这张 page 的组件树；要改它怎么被打开，那是 [`view` 的机器](../../architecture.md#宿主保留的只有机器)。

## 公开区块集

以下组件从 `niceeval/report` 导出。[`AttemptDetail`](attempt-detail.md) 与 [`AttemptAssessment`](attempt-assessment.md) 是组合组件；其余叶子组件都有同名词根的 `*Data` 函数与可序列化 `*Data` 类型，并从 `niceeval/report/react` 导出只接受 `data` 的纯 web renderer。每个区块是一份事实的完整投影，因此都不收结构子节点——作者的取舍在放不放它、按什么顺序放。

| 组件 | 只负责什么 | 空证据 |
|---|---|---|
| `AttemptSummary` | locator、experiment / eval / attempt 身份、verdict、计分制 attempt 的本轮挣分（分数面总读数在详情页的唯一出现处，其它区块不重复它）、开始时间、总耗时、成本与证据能力位 | 身份与 verdict 恒有，不为空 |
| `AttemptError` | 结构化 error、cause 与基础设施失败信息；不重复 assertion | 没有 error 时零输出 |
| `AttemptAssertions` | 非 passed 条目按原始声明顺序列一份平铺列表(failed / soft / unavailable 混排、不分段);passed 条目按 group 折叠成计数;计分制 eval 的 `.points` 挣分随所在断言一并显示,`t.score` 给分记录按 group 单独成一个区块;不渲染源码 | 没有 assertion 且没有给分记录时零输出 |
| [`AttemptSource`](attempt-source.md) | GitHub diff 式带标注源码：TypeScript 轻量语法高亮，send / assertion 按蓝 / 绿 / 红 / 黄整行着色，点击对应源码行展开该轮完整回复与 assertion 细节；计分制下承载全部给分证据——得分点行右缘挂挣分 pill、`t.score` 调用行原位标注给分、前置中止行标 `⤓` 且其后源码降灰，`loc` 不在源码内的得分点与给分记录进 unmapped 区（[计分制展示](../../../scoring/library/display.md#计分制points-与给分记录)） | 没有 source 时零输出,不自行 fallback |
| [`AttemptAssessment`](attempt-assessment.md) | 先放 `AttemptError`，有 source 时放 `AttemptSource`，否则放 `AttemptAssertions` | 子组件都为空时零输出 |
| `AttemptFixPrompt` | 把当前失败的身份、简要失败原因与排查步骤(含 `--source`/`--execution`/`--timing`/`--diff` 提示命令、复跑与确认步骤)组装成单条修复 prompt;不内嵌源码或 diff 原文,由 agent 自己跑命令查看 | 没有可操作失败时零输出。计分制的丢分得分点与前置中止都算可操作失败——`passed` 但有丢分的 attempt 照常出 prompt,围绕丢分检查点组装;挣满且未中止才零输出。通过制 passed 恒零输出 |
| `AttemptTimeline` | runner phases、hook / command / session / turn，以及按 `traceId` 关联的 agent / model / tool spans | 没有 phase 时零输出 |
| `AttemptConversation` | 标准事件流按轮组织的 user / assistant / thinking / tool / Skill / HITL / error 条目,以及 attempt 末尾的失败 Sandbox 命令卡([`commands.json`](../../../record/architecture.md#commandsjson) 投影) | 没有 events 且没有失败命令时零输出 |
| `AttemptDiagnostics` | lifecycle 分组的 diagnostics(warning/error 级别的 code + message + 出现次数) | 没有 diagnostics 时零输出 |
| [`UsageTable`](usage-table.md) | 判定、轮数、工具调用数、token 拆分与成本摊成的单行用量摘要；组装口径见 [`UsageTable` 组装口径（单源）](usage-table.md#组装口径单源) | 没有 usage 时零输出 |
| `AttemptTrace` | 不混入 runner 节点的原始 OTel span 树 / 瀑布 | 没有 trace 时零输出 |
| `AttemptDiff` | generated / modified / deleted 文件摘要与 patch | 没有变更时零输出 |
| [`AttemptDetail`](attempt-detail.md) | 按内建顺序装配以上区块；有 source 时回复已在 `AttemptSource` 行内展开，不再重复 `AttemptConversation`，无 source 时保留独立分轮视图 | 随子组件 |

`AttemptConversationData` 在分轮卡片之外携带 `failedCommands`——[`commands.json`](../../../record/architecture.md#commandsjson) 的投影(含关联时间树的 `timingNodeId`,按 timing `startOffsetMs` 排序);`--execution` 的失败命令卡、`cmd<N>` 句柄与 `--json` 的结构化输出消费的都是这一份字段,终端呈现细则见 [`--execution`](../../show/execution.md)。没有失败命令时字段省略,不摆空数组。

区块按事实边界拆分，不按某个宿主当前的卡片拆分。`AttemptTimeline` 可以把 span 按显式 correlation 挂回 runner 时间树；`AttemptTrace` 则保留原始 OTel 视角，因此二者可以择一，也可以同时放。`AttemptSource` 与 `AttemptAssertions` 会呈现同一批 assertion 的不同视角，默认组合通过 `AttemptAssessment` 二选一，避免重复。`AttemptSource` 还把标准事件流按 `loc` 投影回 send 行，点击行可在源码上下文中展开回复；因此默认 `AttemptDetail` 有 source 时不再追加独立 `AttemptConversation`，没有 source 时才把它作为完整事件流 fallback。报告作者仍可显式同时放置两者，此时两种视角并存是作者选择。

按 `loc` 投影盖不住的事实不丢弃，列在源码块之后的两个**兜底区**：「Other assertions」收 `loc` 缺失或不在展示源码内的断言，逐条平铺、判定语义与 `AttemptAssertions` 的条目一致；「Other conversation」收没有 `loc` 的轮次（动态构造的 send、`loc` 指向其它文件或越界）——有 source 时页面不放独立 `AttemptConversation`，这个兜底区因此是无 `loc` 轮次在页面上唯一的出现处，按 `AttemptConversation` 同形态呈现：分轮卡片带轮标签与状态，内部 user / assistant / thinking / tool / error 条目复用同一套回复渲染，不写第二份实现。工具出入参的单行预览在字符串化**之前**收口自由文本（剥控制字节、折空白）——结构化值先逐字段收口再 `JSON.stringify`，事后处理收不到已经变成字面转义文本的换行与控制字节。

## page 输入与 spec / data 形态

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

每个叶子组件遵守报告库统一的 spec / data 规则，绑定只有一个来源，所以这一族的 props 是两个平坦分支：

```ts
type AttemptSectionProps<Data> =
  | {
      /** 省略时取当前 attempt-input page 注入的 evidence。 */
      input?: AttemptEvidence;
      data?: never;
      className?: string;
    }
  | {
      /** `attempt*Data(...)` 产出的可序列化数据。 */
      data: Data;
      input?: never;
      className?: string;
    };
```

配套计算函数只接受一个 attempt，不接受 Sample：

```ts
attemptSummaryData(evidence: AttemptEvidence): AttemptSummaryData;
attemptErrorData(evidence: AttemptEvidence): AttemptErrorData | null;
attemptAssertionsData(evidence: AttemptEvidence): AttemptAssertionsData | null;
attemptSourceData(evidence: AttemptEvidence): AttemptSourceData | null;
attemptFixPromptData(evidence: AttemptEvidence): AttemptFixPromptData | null;
attemptTimelineData(evidence: AttemptEvidence): AttemptTimelineData | null;
attemptConversationData(evidence: AttemptEvidence): AttemptConversationData | null;
attemptDiagnosticsData(evidence: AttemptEvidence): AttemptDiagnosticsData | null;
usageTableData(evidence: AttemptEvidence): UsageTableData | null;
attemptTraceData(evidence: AttemptEvidence): AttemptTraceData | null;
attemptDiffData(evidence: AttemptEvidence): AttemptDiffData | null;
```

`null` 的计算结果在两个面都渲染为空。组件不自己读 artifact；`loadAttemptEvidence` 已经完成一次性装配，`*Data` 只做适合展示与序列化的派生。Attempt 组件放在 sample-input page 且又没有显式 `input` 时，resolve 以完整用户反馈报错并指引移到 attempt-input page 或传入 evidence。

## 在 `show` 与 `view` 怎样渲染

两个宿主先选中同一张 attempt-input page，再用 locator 得到同一份 `AttemptEvidence` 并 resolve 其 content；区别只在最后一个 face：

| 组件 | `show @locator --report ...` 的 text 面 | `view` 的 web 面 |
|---|---|---|
| `AttemptSummary` | 紧凑身份与 verdict 摘要（计分制含本轮挣分） | 详情标题、状态和统计卡（计分制含本轮挣分） |
| `AttemptError` / `AttemptAssertions` | 有界错误与未通过项列表;不带专属命令(完整 locator 已在 `AttemptSummary` 那一行) | 可展开的完整结构化细节 |
| `AttemptSource` | 未通过 assertion 的源码位置与 expected / received，加 `--source` 命令；含轮次时同时保留 `--execution` 下钻入口，不倾倒整份源码；计分制同时列得分点挣分与给分记录 | TypeScript 语法高亮的完整源码；send / pass / gate-fail / soft-fail 行分别着色，可点击展开该轮回复或 assertion 细节；计分制附挣分 pill、给分行标注与中止后降灰 |
| `AttemptFixPrompt` | 零输出；终端已有可直接交给 agent 的 evidence 命令 | 单条失败的复制按钮与完整 prompt |
| `AttemptTimeline` | phase 摘要与 `--timing` 命令 | 可逐层展开的 runner + correlated spans 时间树 |
| `AttemptConversation` | 轮次摘要与 `--execution` 命令 | 完整分轮事件卡 |
| `AttemptDiagnostics` | 紧凑分组列表 | 分组 details |
| `UsageTable` | 单行 `usage:` 摘要（组装口径见 [`UsageTable` 组装口径（单源）](usage-table.md#组装口径单源)） | 同一口径的数值表 |
| `AttemptTrace` | span 摘要与 `--timing` 命令 | 原始 span 瀑布与树 |
| `AttemptDiff` | 文件摘要与 `--diff` 命令 | 文件列表与可展开 patch |

text 面允许把有稳定 CLI 选择器的大块内容折成摘要加命令，但不能改变判定、计数、可用性或引用；专用 `--source` / `--execution` / `--timing` / `--diff` 仍是 Results evidence 的深度终端投影，不是另一套组件数据。

`show @<locator>` 是「选择报告中唯一的 attempt-input page + 传 locator」的快捷语法；不带 `--report` 时选择内建 `standard` 里的那张 page。

## 相关阅读

- [组件树](../README.md) —— 这一族为什么不收结构子节点。
- [`AttemptSource`](attempt-source.md) —— web 面视觉规范。
- [`UsageTable`](usage-table.md) —— 用量组装口径（单源）。
- [`AttemptAssessment`](attempt-assessment.md) / [`AttemptDetail`](attempt-detail.md) —— 两个组合组件。
- [外壳与多页](../../library/shell.md) —— 参数化 page 的字段与校验。
- [排版原语与自定义组件](../../library/layout.md) —— page context 与双面组件协议。
- [内建报告](../../library/built-in.md) —— `standard` 的四张 page 全文。
- [Architecture](../../architecture.md) —— 单一 page 模型与宿主机器边界。
