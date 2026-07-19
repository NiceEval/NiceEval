# Attempt 详情组件

Attempt 详情是一张 page，不是 `ReportDefinition` 的第二个内容槽。它和其它 page 一样只有 `id`、标题、输入声明与一棵 `content: ReportNode`；区别只是 `input: "attempt"` 表示宿主必须先用 locator 装配一份 [`AttemptEvidence`](../../results/library.md)，`navigation: false` 表示它没有 locator 时不进入导航。

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

## 公开组件集

以下组件从 `niceeval/report` 导出。`AttemptDetail` 与 `AttemptAssessment` 是组合组件；其余叶子组件都有同名词根的 `*Data` 函数与可序列化 `*Data` 类型，并从 `niceeval/report/react` 导出只接受 `data` 的纯 web renderer。

| 组件 | 只负责什么 | 空证据 |
|---|---|---|
| `AttemptSummary` | locator、experiment / eval / attempt 身份、verdict、开始时间、总耗时、成本与证据能力位 | 身份与 verdict 恒有，不为空 |
| `AttemptError` | 结构化 error、cause 与基础设施失败信息；不重复 assertion | 没有 error 时零输出 |
| `AttemptAssertions` | 全量 assertion，按 failed / soft / unavailable / passed 与 group 组织；不渲染源码 | 没有 assertion 时零输出 |
| `AttemptSource` | 带 send / assertion 标注的 eval 源码；行内展开 assertion 细节 | 没有 source 时零输出，不自行 fallback |
| `AttemptAssessment` | 先放 `AttemptError`，有 source 时放 `AttemptSource`，否则放 `AttemptAssertions` | 子组件都为空时零输出 |
| `AttemptFixPrompt` | 把当前失败的身份、error / assertion、相关源码与变更摘要组装成单条修复 prompt | passed 或没有可操作失败时零输出 |
| `AttemptTimeline` | runner phases、hook / command / session / turn，以及按 `traceId` 关联的 agent / model / tool spans | 没有 phase 时零输出 |
| `AttemptConversation` | 标准事件流按轮组织的 user / assistant / thinking / tool / Skill / HITL / error 条目 | 没有 events 时零输出 |
| `AttemptDiagnostics` | lifecycle 分组的 diagnostics 与 coverage reason | 没有 diagnostics 时零输出 |
| `AttemptUsage` | token、cache token、成本及 provider usage 明细 | 没有 usage 时零输出 |
| `AttemptTrace` | 不混入 runner 节点的原始 OTel span 树 / 瀑布 | 没有 trace 时零输出 |
| `AttemptDiff` | generated / modified / deleted 文件摘要与 patch | 没有变更时零输出 |
| `AttemptDetail` | 按内建顺序装配以上区块的成品组合；不产生新的 data 或渲染面 | 随子组件 |

区块按事实边界拆分，不按某个宿主当前的卡片拆分。`AttemptTimeline` 可以把 span 按显式 correlation 挂回 runner 时间树；`AttemptTrace` 则保留原始 OTel 视角，因此二者可以择一，也可以同时放。`AttemptSource` 与 `AttemptAssertions` 会呈现同一批 assertion 的不同视角，默认组合通过 `AttemptAssessment` 二选一，避免重复；作者显式同时放置时，重复是作者选择。

## page 输入与 spec / data 形态

attempt-input page 的 resolve context 是判别联合的一支：

```ts
type PageContext =
  | { id: string; input: "scope" }
  | {
      id: string;
      input: "attempt";
      locator: AttemptLocator;
      evidence: AttemptEvidence;
    };
```

每个叶子组件遵守报告库统一的 spec / data 规则：

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

配套计算函数只接受一个 attempt，不接受 Scope：

```ts
attemptSummaryData(evidence: AttemptEvidence): AttemptSummaryData;
attemptErrorData(evidence: AttemptEvidence): AttemptErrorData | null;
attemptAssertionsData(evidence: AttemptEvidence): AttemptAssertionsData | null;
attemptSourceData(evidence: AttemptEvidence): AttemptSourceData | null;
attemptFixPromptData(evidence: AttemptEvidence): AttemptFixPromptData | null;
attemptTimelineData(evidence: AttemptEvidence): AttemptTimelineData | null;
attemptConversationData(evidence: AttemptEvidence): AttemptConversationData | null;
attemptDiagnosticsData(evidence: AttemptEvidence): AttemptDiagnosticsData | null;
attemptUsageData(evidence: AttemptEvidence): AttemptUsageData | null;
attemptTraceData(evidence: AttemptEvidence): AttemptTraceData | null;
attemptDiffData(evidence: AttemptEvidence): AttemptDiffData | null;
```

`null` 的计算结果在两个面都渲染为空。组件不自己读 artifact；`loadAttemptEvidence` 已经完成一次性装配，`*Data` 只做适合展示与序列化的派生。Attempt 组件放在 scope-input page 且又没有显式 `input` 时，resolve 以完整用户反馈报错并指引移到 attempt-input page 或传入 evidence。

## 两个普通组合组件

`AttemptAssessment` 只表达 source / assertions fallback：

```tsx
export const AttemptAssessment = defineComponent((_props, ctx) => {
  if (ctx.page.input !== "attempt") {
    throw new Error("AttemptAssessment requires an attempt-input page");
  }
  return (
    <Col>
      <AttemptError />
      {ctx.page.evidence.capabilities.source
        ? <AttemptSource />
        : <AttemptAssertions />}
    </Col>
  );
});
```

`AttemptDetail` 只表达内建排列顺序，全文是：

```tsx
export const AttemptDetail = defineComponent(() => (
  <Col>
    <AttemptSummary />
    <AttemptAssessment />
    <AttemptFixPrompt />
    <AttemptTimeline />
    <AttemptDiagnostics />
    <AttemptUsage />
    <AttemptConversation />
    <AttemptTrace />
    <AttemptDiff />
  </Col>
));
```

用户可以在参数化 page 中直接重排公开区块，不需要复制 view：

```tsx
{
  id: "attempt",
  title: "Failure review",
  input: "attempt",
  navigation: false,
  content: (
    <Col>
      <AttemptSummary />
      <AttemptAssessment />
      <AttemptDiff />
      <AttemptConversation />
    </Col>
  ),
}
```

报告没有 attempt-input page 时，locator 在 web / text 两面都只显示为普通文本，宿主不追加官方详情作为 fallback。自有 React 页面仍可通过组件自己的 `attemptHref` 显式接到外部路由。

## 在 `show` 与 `view` 怎样渲染

两个宿主先选中同一张 attempt-input page，再用 locator 得到同一份 `AttemptEvidence` 并 resolve 其 content；区别只在最后一个 face：

| 组件 | `show @locator --report ...` 的 text 面 | `view` 的 web 面 |
|---|---|---|
| `AttemptSummary` | 紧凑身份与 verdict 摘要 | 详情标题、状态和统计卡 |
| `AttemptError` / `AttemptAssertions` | 有界错误与未通过项；保留完整 locator / source 命令 | 可展开的完整结构化细节 |
| `AttemptSource` | 未通过 assertion 的源码位置与 expected / received，加 `--source` 命令；不倾倒整份源码 | 完整带标注源码，失败行可展开 |
| `AttemptFixPrompt` | 零输出；终端已有可直接交给 agent 的 evidence 命令 | 单条失败的复制按钮与完整 prompt |
| `AttemptTimeline` | phase 摘要与 `--timing` 命令 | 可逐层展开的 runner + correlated spans 时间树 |
| `AttemptConversation` | 轮次摘要与 `--execution` 命令 | 完整分轮事件卡 |
| `AttemptDiagnostics` / `AttemptUsage` | 紧凑分组列表 / 数值表 | 分组 details / usage 表 |
| `AttemptTrace` | span 摘要与 `--timing` 命令 | 原始 span 瀑布与树 |
| `AttemptDiff` | 文件摘要与 `--diff` 命令 | 文件列表与可展开 patch |

text 面允许把有稳定 CLI 选择器的大块内容折成摘要加命令，但不能改变判定、计数、可用性或引用；专用 `--source` / `--execution` / `--timing` / `--diff` 仍是 Results evidence 的深度终端投影，不是另一套组件数据。

view 为每个可达 locator 生成这张 page 的完整静态文档。基线链接直接打开该文档；增强脚本可以拦截链接，把同一份 web 输出放进 dialog，不能另调一份私有 renderer。show 的 `@<locator>` 则是“选择报告中唯一的 attempt-input page + 传 locator”的快捷语法；不带 `--report` 时选择内建 `standard` 里的那张 page。

## 相关阅读

- [外壳与多页](shell.md) —— 参数化 page 的字段与校验。
- [排版原语与自定义组件](layout.md) —— page context 与双面组件协议。
- [内建报告](built-in.md) —— `standard` 的四张 page 全文。
- [Architecture](../architecture.md) —— 单一 page 模型与宿主机器边界。
