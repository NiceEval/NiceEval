# Attempt 详情

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

**详情的弹窗形态属于宿主摆放，不是一个组件。** `view` 为每个可达 locator 物化一份完整静态文档，基线链接直接打开它；增强脚本可以拦截链接、把同一份 web 输出放进 dialog，但 dialog 内部的区块、顺序、样式和取舍全部来自这张 page 的 content。因此报告库里没有「弹窗组件」可配置——要改弹窗里有什么，改的是这张 page 的组件树；要改它怎么被打开，那是 [`view` 的机器](../architecture.md#宿主保留的只有机器)。

## 公开区块集

以下组件从 `niceeval/report` 导出。`AttemptDetail` 与 `AttemptAssessment` 是组合组件；其余叶子组件都有同名词根的 `*Data` 函数与可序列化 `*Data` 类型，并从 `niceeval/report/react` 导出只接受 `data` 的纯 web renderer。每个区块是一份事实的完整投影，因此都不收结构子节点——作者的取舍在放不放它、按什么顺序放。

| 组件 | 只负责什么 | 空证据 |
|---|---|---|
| `AttemptSummary` | locator、experiment / eval / attempt 身份、verdict、计分制 attempt 的本轮挣分（分数面总读数在详情页的唯一出现处，其它区块不重复它）、开始时间、总耗时、成本与证据能力位 | 身份与 verdict 恒有，不为空 |
| `AttemptError` | 结构化 error、cause 与基础设施失败信息；不重复 assertion | 没有 error 时零输出 |
| `AttemptAssertions` | 非 passed 条目按原始声明顺序列一份平铺列表(failed / soft / unavailable 混排、不分段);passed 条目按 group 折叠成计数;计分制 eval 的 `.points` 挣分随所在断言一并显示,`t.score` 给分记录按 group 单独成一个区块;不渲染源码 | 没有 assertion 且没有给分记录时零输出 |
| `AttemptSource` | GitHub diff 式带标注源码：TypeScript 轻量语法高亮，send / assertion 按蓝 / 绿 / 红 / 黄整行着色，点击对应源码行展开该轮完整回复与 assertion 细节；计分制下承载全部给分证据——得分点行右缘挂挣分 pill、`t.score` 调用行原位标注给分、前置中止行标 `⤓` 且其后源码降灰，`loc` 不在源码内的得分点与给分记录进 unmapped 区（[计分制展示](../../scoring/library/display.md#计分制points-与给分记录)） | 没有 source 时零输出,不自行 fallback |
| `AttemptAssessment` | 先放 `AttemptError`，有 source 时放 `AttemptSource`，否则放 `AttemptAssertions` | 子组件都为空时零输出 |
| `AttemptFixPrompt` | 把当前失败的身份、简要失败原因与排查步骤(含 `--source`/`--execution`/`--timing`/`--diff` 提示命令、复跑与确认步骤)组装成单条修复 prompt;不内嵌源码或 diff 原文,由 agent 自己跑命令查看 | 没有可操作失败时零输出。计分制的丢分得分点与前置中止都算可操作失败——`passed` 但有丢分的 attempt 照常出 prompt,围绕丢分检查点组装;挣满且未中止才零输出。通过制 passed 恒零输出 |
| `AttemptTimeline` | runner phases、hook / command / session / turn，以及按 `traceId` 关联的 agent / model / tool spans | 没有 phase 时零输出 |
| `AttemptConversation` | 标准事件流按轮组织的 user / assistant / thinking / tool / Skill / HITL / error 条目,以及 attempt 末尾的失败 Sandbox 命令卡([`commands.json`](../../results/architecture.md#commandsjson) 投影) | 没有 events 且没有失败命令时零输出 |
| `AttemptDiagnostics` | lifecycle 分组的 diagnostics(warning/error 级别的 code + message + 出现次数) | 没有 diagnostics 时零输出 |
| `UsageTable` | 判定、轮数、工具调用数、token 拆分与成本摊成的单行用量摘要；组装口径见 [`UsageTable` 组装口径（单源）](#usagetable-组装口径单源) | 没有 usage 时零输出 |
| `AttemptTrace` | 不混入 runner 节点的原始 OTel span 树 / 瀑布 | 没有 trace 时零输出 |
| `AttemptDiff` | generated / modified / deleted 文件摘要与 patch | 没有变更时零输出 |
| `AttemptDetail` | 按内建顺序装配以上区块；有 source 时回复已在 `AttemptSource` 行内展开，不再重复 `AttemptConversation`，无 source 时保留独立分轮视图 | 随子组件 |

`AttemptConversationData` 在分轮卡片之外携带 `failedCommands`——[`commands.json`](../../results/architecture.md#commandsjson) 的投影(含关联时间树的 `timingNodeId`,按 timing `startOffsetMs` 排序);`--execution` 的失败命令卡、`cmd<N>` 句柄与 `--json` 的结构化输出消费的都是这一份字段,终端呈现细则见 [`--execution`](../show/execution.md)。没有失败命令时字段省略,不摆空数组。

区块按事实边界拆分，不按某个宿主当前的卡片拆分。`AttemptTimeline` 可以把 span 按显式 correlation 挂回 runner 时间树；`AttemptTrace` 则保留原始 OTel 视角，因此二者可以择一，也可以同时放。`AttemptSource` 与 `AttemptAssertions` 会呈现同一批 assertion 的不同视角，默认组合通过 `AttemptAssessment` 二选一，避免重复。`AttemptSource` 还把标准事件流按 `loc` 投影回 send 行，点击行可在源码上下文中展开回复；因此默认 `AttemptDetail` 有 source 时不再追加独立 `AttemptConversation`，没有 source 时才把它作为完整事件流 fallback。报告作者仍可显式同时放置两者，此时两种视角并存是作者选择。

按 `loc` 投影盖不住的事实不丢弃，列在源码块之后的两个**兜底区**：「Other assertions」收 `loc` 缺失或不在展示源码内的断言，逐条平铺、判定语义与 `AttemptAssertions` 的条目一致；「Other conversation」收没有 `loc` 的轮次（动态构造的 send、`loc` 指向其它文件或越界）——有 source 时页面不放独立 `AttemptConversation`，这个兜底区因此是无 `loc` 轮次在页面上唯一的出现处，按 `AttemptConversation` 同形态呈现：分轮卡片带轮标签与状态，内部 user / assistant / thinking / tool / error 条目复用同一套回复渲染，不写第二份实现。工具出入参的单行预览在字符串化**之前**收口自由文本（剥控制字节、折空白）——结构化值先逐字段收口再 `JSON.stringify`，事后处理收不到已经变成字面转义文本的换行与控制字节。

## `AttemptSource` web 面视觉规范

`AttemptSource` 的 web 面与产品站首页的 eval 示例卡（`site/components/site-home-setup.tsx` + `site/app/globals.css` 的 `.eval-code` 族）是同一套视觉语言的两份实现：示例卡是这套「源码即报告」叙事的公开形象，报告里的真实源码视图与它同语言，用户从官网到报告不切换视觉心智。二者不共享组件——示例卡是需要 hydration 的营销交互（React state 展开、轮播、埋点），`AttemptSource` 按报告契约必须在零 JS 的静态 attempt 文档里完整成立；数据上示例卡是策划数据，`AttemptSource` 是真实证据（一行多条 assertion、四种 tone、unmapped / unlocated 区）。因此对齐的单位是下面这份规范，不是组件：

- **密度**：等宽 12.5px / 1.65 行高；整块源码统一横向滚动，普通行之间不画分隔线；行盒撑到最长行宽度，状态底色与左缘盖满整行，不在横向滚动后断成半截。
- **行状态**：状态 = 整行浅染 + 2px 左缘 + 行号位图标。send 行蓝、passed 绿、gate-fail 红、soft-fail / unavailable 黄；浅染是 tone 色约 8% 的透明混合，不是饱和色块。有状态的行用内联 SVG 图标顶替行号（send 对话气泡、passed 圈勾、failed 圈叉、soft-fail 圈叹号、unavailable 圈问号；不引第三方图标库），普通行显示行号。计分制的前置中止行按 gate-fail 红；中止行之后的全部源码行整体降灰（未到达——那些行没有任何断言或给分记录，不是因为没写，是因为没跑到），行号照常显示。
- **给分行**：`t.score(...)` 调用行不着判定色——给分是分数面事实，不是判定；行号照常，右缘挂挣分 pill，展开区显示该条给分记录（label、挣分、分组路径）。`loc` 不在展示源码内的得分点与给分记录列在源码块后的 unmapped 区，给分记录按 `groupPath` 分组（与 `AttemptAssertions` 同一套分组算法）。
- **右缘 meta**：行右侧只放分数 pill（soft 的阈值分数，或计分制的挣分 `+1 pt` / `+0 pts`）、中止行的 `⤓` 标记与展开 chevron，钉在滚动视口右缘（sticky），横向滚动时始终可见；不显示内部 turn 标签（如 `turn1`）。
- **展开区**：点击行展开的回复 / assertion 细节直接接在源码行下，dashed 上边线 + tone 色左缘；按容器可视宽度排版换行并钉在滚动视口左缘，不跟随代码横向滚动；不套二级卡片，不重复 turn 头与 sent prompt。首个失败或警告行默认展开。
- **语法高亮**：零依赖逐行 TypeScript token（comment / string / keyword / number / function 五类语义 class）；暗色 token 取 VS Code Dark+ 系（与示例卡的 prism vsDark 主题同源），浅色为等价可读色。
- **兜底区**：源码块之后、与源码块同宽。「Other conversation」的分轮卡片带 verdict 色左缘与轮标签头行（这里没有可依附的 send 行，轮标签是该轮唯一的身份锚），卡片内部条目与 `AttemptConversation` 同视觉语言；回复条目在每个渲染容器里都必须有完整样式覆盖——`.nre-conv-*` 规则按容器限定，新容器不会自动继承。
- **交互载体**：展开一律是原生 `<details>`，静态文档零 JS 成立。

这份规范与官方 stylesheet 组合后的实际观感（染色、布局、滚动、展开交互）由 [E2E 报告域](../../../engineering/testing/e2e/report.md)在真实浏览器里验收，单元层只覆盖数据投影与 DOM 结构事实。

## `UsageTable` 组装口径（单源）

`UsageTable` 把一个 attempt 的用量摊成一行：判定、轮数、工具调用数、token 拆分与成本。它是 show 与 view 里凡出现 usage 数字的地方——attempt 详情首页的单行 `usage:` 摘要、`--usage` 表的每一行、对照矩阵的用量列、`--execution` turn 头行——共同的组装口径与数据来源，事实来自两处、不混淆：

- **行为计数来自标准事件流**：轮数（`turns`）与工具调用数（`toolCalls`）从 `events.json` 派生，与 [`o11y.json` 行为摘要](../../results/architecture.md#o11yjson)同源。
- **token 与请求计数来自落盘 `Usage`**：字段契约见 [Results · Usage](../../results/architecture.md#usage)。每个字段只在协议真实提供时存在；`requests` 是真实发生的模型请求数，协议不提供就整个不显示——绝不显示一个凑数的 1。
- **`inputTokens` 就是未缓存输入**（token 桶恒互斥，契约见 [Results · Usage](../../results/architecture.md#usage)）：`cacheReadTokens` 在场时 token 片段显示为 `X uncached in + Y cache read`，把拆分摆在明面；`cacheReadTokens` 缺席时显示 `X in`，不给没有拆分事实的数字贴 "uncached" 标注。缓存命中的输入同样计费，效率对比必须能看到这层拆分。

text 面的单行装配形态——attempt 详情首页的 `usage:` 行就是这一形态本身，不是它的近似摘要：

```text
usage: 6 turns · 21 tool calls · 62.3k uncached in + 942.6k cache read / 6.7k out · 24 requests · $1.14
```

某段事实缺失时对应片段整段省略，剩余片段保持顺序；全部缺失时整行不出现，与组件表「没有 usage 时零输出」同一条规则。

`usageTableData` 的可序列化形状，字段名与落盘 `Usage`、事件派生量、attempt 身份字段保持一致，不为展示发明第二套命名：

```ts
interface UsageTableData {
  locator: string;
  experimentId: string;
  evalId: string;
  attempt: number;
  verdict: AttemptRecord["verdict"];
  turns?: number;                // 事件流派生；无 events 时省略
  toolCalls?: number;
  usage?: Usage;                 // 落盘原样，字段契约见 Results · Usage
  estimatedCostUSD?: number;
}
```

`show --usage` 的多行用量表是同一组件按 attempt 逐条映射后的宿主装配：范围内每个 attempt 各贡献一份 `UsageTableData`，分节、排序、合计行与占位规则属于宿主机器，装配细节见 [`--usage`](../show/usage.md)。

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
usageTableData(evidence: AttemptEvidence): UsageTableData | null;
attemptTraceData(evidence: AttemptEvidence): AttemptTraceData | null;
attemptDiffData(evidence: AttemptEvidence): AttemptDiffData | null;
```

`null` 的计算结果在两个面都渲染为空。组件不自己读 artifact；`loadAttemptEvidence` 已经完成一次性装配，`*Data` 只做适合展示与序列化的派生。Attempt 组件放在 scope-input page 且又没有显式 `input` 时，resolve 以完整用户反馈报错并指引移到 attempt-input page 或传入 evidence。

## 两个组合组件

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

### `AttemptDetail`

`AttemptDetail` 只表达内建排列顺序，全文是：

```tsx
export const AttemptDetail = defineComponent((_props, ctx) => {
  const conversationLivesInSource =
    ctx.page.input === "attempt" &&
    ctx.page.evidence.capabilities.source &&
    ctx.page.evidence.evalSource !== null;
  return (
    <Col>
      <AttemptSummary />
      <AttemptAssessment />
      <AttemptFixPrompt />
      <AttemptTimeline />
      <AttemptDiagnostics />
      <UsageTable />
      {conversationLivesInSource ? null : <AttemptConversation />}
      <AttemptTrace />
      <AttemptDiff />
    </Col>
  );
});
```

它不接受结构子节点：要换顺序或删区块，就在参数化 page 里直接摆公开区块，不需要复制 view：

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
| `AttemptSummary` | 紧凑身份与 verdict 摘要（计分制含本轮挣分） | 详情标题、状态和统计卡（计分制含本轮挣分） |
| `AttemptError` / `AttemptAssertions` | 有界错误与未通过项列表;不带专属命令(完整 locator 已在 `AttemptSummary` 那一行) | 可展开的完整结构化细节 |
| `AttemptSource` | 未通过 assertion 的源码位置与 expected / received，加 `--source` 命令；含轮次时同时保留 `--execution` 下钻入口，不倾倒整份源码；计分制同时列得分点挣分与给分记录 | TypeScript 语法高亮的完整源码；send / pass / gate-fail / soft-fail 行分别着色，可点击展开该轮回复或 assertion 细节；计分制附挣分 pill、给分行标注与中止后降灰 |
| `AttemptFixPrompt` | 零输出；终端已有可直接交给 agent 的 evidence 命令 | 单条失败的复制按钮与完整 prompt |
| `AttemptTimeline` | phase 摘要与 `--timing` 命令 | 可逐层展开的 runner + correlated spans 时间树 |
| `AttemptConversation` | 轮次摘要与 `--execution` 命令 | 完整分轮事件卡 |
| `AttemptDiagnostics` | 紧凑分组列表 | 分组 details |
| `UsageTable` | 单行 `usage:` 摘要（组装口径见 [`UsageTable` 组装口径（单源）](#usagetable-组装口径单源)） | 同一口径的数值表 |
| `AttemptTrace` | span 摘要与 `--timing` 命令 | 原始 span 瀑布与树 |
| `AttemptDiff` | 文件摘要与 `--diff` 命令 | 文件列表与可展开 patch |

text 面允许把有稳定 CLI 选择器的大块内容折成摘要加命令，但不能改变判定、计数、可用性或引用；专用 `--source` / `--execution` / `--timing` / `--diff` 仍是 Results evidence 的深度终端投影，不是另一套组件数据。

`show @<locator>` 是「选择报告中唯一的 attempt-input page + 传 locator」的快捷语法；不带 `--report` 时选择内建 `standard` 里的那张 page。

## 相关阅读

- [组件树](README.md) —— 这一族为什么不收结构子节点。
- [外壳与多页](../library/shell.md) —— 参数化 page 的字段与校验。
- [排版原语与自定义组件](../library/layout.md) —— page context 与双面组件协议。
- [内建报告](../library/built-in.md) —— `standard` 的四张 page 全文。
- [Architecture](../architecture.md) —— 单一 page 模型与宿主机器边界。
</content>
