# 排版原语与自定义组件

`Row`、`Col`、`Section`、`Text`、`Style`、`Tabs`、`Tab` 和 `Table` 是八个内置双面排版组件，用于组织报告树。

## 树的节点：`ReportNode`

报告树里每个可放内容的位置——排版原语的 `children`、页的 `content`、组合组件的返回值——类型都是 `ReportNode`，形状穷尽如下：

```ts
type ReportNode =
  | ReportElement                 // 双面组件、组合组件或排版原语经 JSX 产生的元素
  | readonly ReportNode[]         // 节点列表；Fragment（<>…</>）等价于列表
  | null | undefined | boolean;   // 条件渲染的空分支，渲染为空
```

- **元素**只有一类来源：`defineComponent` 产物或内置原语。React 组件、未经 `defineComponent` 的普通函数、任意 HTML intrinsic 都不是节点，resolve 展开遇到时按完整用户反馈拒绝。
- **数组与 Fragment** 展平后按声明顺序渲染，两个渲染面一致；`groups.map(...)` 这类列表产物因此直接可用。
- **`null` / `undefined` / `boolean` 渲染为空**，让 `cond && <X />` 的条件渲染习惯直接可用。
- **裸字符串与数字不是节点**：自由文本必须经 `Text` 携带——text 面的折行宽度与 web 面的转义都需要显式载体。树校验遇到裸字符串或数字时按完整用户反馈拒绝，并指引包 `Text`。
- **`ReportDefinition` 不是节点**（见[外壳与多页](shell.md)）：外壳不可嵌套由类型保证。

## 排版原语

八个原语的公开形状是：

```ts
interface LayoutProps {
  children?: ReportNode;
  className?: string;
}

type RowProps = LayoutProps;
type ColProps = LayoutProps;

interface SectionProps extends LayoutProps {
  title: LocalizedText;
}

interface TextProps {
  /** 自由正文原样渲染，不随 locale 自动翻译。 */
  children: string | number;
  className?: string;
}

interface StyleProps {
  children: string;
}

interface TabsProps extends LayoutProps {}

interface TabProps extends LayoutProps {
  title: LocalizedText;
}
```

宿主语言切换只选择 `LocalizedText` 字段和官方 chrome 词典；`Text` 的自由正文是内容而不是 chrome，需要多语时由作者生成两份报告或使用自定义双面组件，不在数据层按 locale 重算指标。

`Col` 在两个面都按声明序纵向排列。`Row` 的 web 面横排；text 面在可用宽度装得下全部子块时按显示宽度并排（与下文 `columns` 工具同一把尺），装不下时整块退化为纵向堆叠——不截断、不隐藏任何子块。

`Style` 注入的 CSS 是页级全局的：树位置只决定声明顺序，不限定作用域；text 面零输出。它服务树形态文件与自带样式的组件——配置对象形态的报告要全站样式优先用外壳 [`styles`](shell.md)，两条通道注入同一增强层、遵守同一不变量。

```tsx
// reports/nightly.tsx —— 排版原语组织报告树的完整文件形态
import {
  Col, MetricTable, Row, Section, Style, Text,
  costUSD, defineReport, endToEndPassRate,
} from "niceeval/report";

export default defineReport(
  <Col>
    <Text className="team-note">nightly benchmark · publishes at 06:00</Text>
    <Row>
      <Section title="Overall">
        <MetricTable rows="agent" columns={[endToEndPassRate, costUSD]} sort={endToEndPassRate} />
      </Section>
      <Section title="Cost">
        <MetricTable rows="agent" columns={[costUSD, endToEndPassRate]} sort={costUSD} />
      </Section>
    </Row>
    <Style>{`.nre .team-note { color: #6b7280; }`}</Style>
  </Col>,
);
```

本页其余示例都是这样一棵报告树中的片段；更多完整文件按场景收在[配方](recipes.md)。

## `Tabs`

把一页里的并列视图组织成可切换的块。tab 是页内浏览状态，不是数据边界，也不是宿主寻址单位——需要能从 CLI 单独打开、有自己路由和导航项的块，用[页](shell.md)而不是 tab。tab 不进 `defineReport` 的配置对象：把 tab 提到定义层，它就会被追问 id、深链和 CLI 选择器，页与 tab 的边界就塌了。

```tsx
<Tabs>
  <Tab title="质量 × 成本">
    <MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />
  </Tab>
  <Tab title="分科得分">
    <Scoreboard rows="agent" questions={["security/sql-injection", "correctness/retry"]} score={examScore} />
  </Tab>
</Tabs>
```

- 两个渲染面都输出全部 tab 的完整内容。web 面静态 HTML 把每个 tab 渲染为独立 `<details>`，第一个默认展开；渐进增强把它们变成单选 tab 条。切换是纯浏览状态，不改变数据、指标口径或初始 HTML 中的数值。text 面按声明顺序把每个 tab 输出为带标题的分节。
- `Tabs` 必须至少含一个直接 `Tab` 子节点，`Tab` 也只能直接放在 `Tabs` 下；空 Tabs、普通组件混作直接子节点或游离 Tab 在树校验期给出完整用户反馈。tab 内容内部仍可放任意 `ReportNode`。
- `Tab` 除通用 `children` / `className` 外只有 `title: LocalizedText`。tab 不参与路由，没有 id，也没有 CLI 选择器。
- **text 面不给 tab 做索引，也不隐藏任何 tab。** 可比组和页在 text 面折成索引，是因为它们有可复制的下钻命令；tab 没有选择器，索引只能是死路，所以 `show` 全量输出。多 tab 报告在终端长到读不动，正是把这些 tab 升级成[页](shell.md)的信号——这层阅读压力是设计的一部分，不用隐藏内容来缓解。

## `Table`

自定义表格的标准件：给一份 `columns` 和 `rows`，text 面按显示宽度对齐、web 面输出 `<table>`。

```tsx
<Table
  columns={[
    { key: "eval", header: "题目" },
    { key: "pass", header: "通过率", align: "right" },
    { key: "cost", header: "成本", align: "right" },
  ]}
  rows={[
    {
      key: "memory/写缓存",
      locator: "@160iuj3h",
      cells: { eval: "memory/写缓存", pass: "87%", cost: "$0.09" },
    },
    {
      key: "memory/读缓存",
      cells: { eval: "memory/读缓存", pass: null, cost: null },
    },
  ]}
/>
```

```ts
interface TableColumn {
  key: string;
  header: LocalizedText;
  align?: "left" | "right";
}

interface TableRow {
  key: string;
  cells: Readonly<Record<string, string | null>>;
  locator?: AttemptLocator;
}

interface TableProps {
  columns: readonly [TableColumn, ...TableColumn[]];
  rows: readonly TableRow[];
  locale?: ReportLocale;
  className?: string;
}
```

`TableProps`：

| Prop | 类型 | 含义 |
|---|---|---|
| `columns` | `readonly [TableColumn, ...TableColumn[]]` | 非空列定义；数组顺序即渲染顺序 |
| `rows` | `readonly TableRow[]` | 行数据；数组顺序即渲染顺序 |
| `locale` | `ReportLocale` | 组件自带文案的语言；省略时随宿主 |
| `className` | `string` | web 面挂在 `<table>` 上 |

`TableColumn`：

| 字段 | 类型 | 含义 |
|---|---|---|
| `key` | `string` | 取 `row.cells[key]` 的键 |
| `header` | `LocalizedText` | 表头文案，按渲染 locale 选择 |
| `align` | `"left" \| "right"` | 默认 `"left"`；`"right"` 按显示宽度右对齐，数字列用 |

`TableRow`：

| 字段 | 类型 | 含义 |
|---|---|---|
| `key` | `string` | 行身份 |
| `cells` | `Record<string, string \| null>` | 已格式化的显示值 |
| `locator` | `AttemptLocator` | 可选；带上就多一列 attempt |

渲染契约：

- **列宽按显示宽度算**，CJK / 全角记 2 列。中文列不会撕歪。
- **列 key 与行 key 都必须唯一。** `cells` 出现未声明的 key 以完整用户反馈报错；缺少已声明 key 则按 `null` 处理。空列数组由 TypeScript 拒绝，无类型 JavaScript 输入在组件创建时同样报错。
- **`null` 渲染成 `—`**，不补 0；`cells` 里缺这个键同样是 `—`。
- **超宽先折行再丢列。** 总宽超过可用列宽时，先压最宽的左对齐列（按显示宽度折行）；右对齐列不折行——数字折行读不了。左对齐列压到下限仍放不下，就从右侧丢列，并在表下如实标注丢了几列。
- **两个面各自成立。** text 面列间 3 空格、首行表头；web 面是 `<table>` + `<thead>` / `<tbody>`，右对齐落成 `nre-align-right` 类，不用内联样式。
- **带 `locator` 的行接证据室。** 有任一行带 `locator` 时多出一列 attempt：web 面是指向证据室的链接，text 面列出 locator（`niceeval show <locator>` 的位置参数）。

`MetricTable`、`MetricMatrix`、`Scoreboard` 和 `DeltaTable` 的 text 面建在 `Table` 上：自定义表和官方表用同一把尺子。

## 文本排版工具箱

表格之外的形态要自己写 text 面时，用 `niceeval/report` 导出的这组纯函数。不要用 `String.prototype.padEnd` / `padStart` 对齐：它们数的是 UTF-16 码元，不是终端显示列宽，agent 名或 eval id 一带中文，整张表就撕歪。

| 导出 | 签名 | 用途 |
|---|---|---|
| `stringWidth` | `(text: string) => number` | 显示宽度：CJK / 全角记 2 列，其余 1 列 |
| `padEnd` | `(text: string, width: number) => string` | 按显示宽度在右侧补齐（左对齐） |
| `padStart` | `(text: string, width: number) => string` | 按显示宽度在左侧补齐（右对齐，数字列用） |
| `wrapText` | `(text: string, width: number) => string[]` | 按显示宽度折行 |
| `indent` | `(block: string, prefix: string) => string` | 每行加缩进 |
| `bar` | `(ratio: number, width: number) => string` | 字符条：`█` 填充、`░` 补齐到 `width` |
| `columns` | `(blocks: string[], widths: number[], separator?: string) => string` | 多块并排 |

## 自定义组件

`defineComponent` 定义可入报告树的组件，两种入参形态产出同一种报告组件（模型定义在 [Architecture · 组件模型](../architecture.md#组件模型解析面与渲染面)）：

```ts
interface ComposeContext {
  /** 宿主注入的 Scope。 */
  scope: Scope;
  /** 结果根完整读取面；历史视图从这里自行挑 Snapshot[]。 */
  results: Results;
  /** 规范化后的报告声明，只读；见下方 ReportMeta。 */
  report: ReportMeta;
}

interface ReportMeta {
  /** 走完回退链（声明 title → 唯一快照 name → "NiceEval"）后的标题。 */
  title: LocalizedText;
  /** 页头外链；声明省略时为空数组。 */
  links: readonly ReportLink[];
  footer?: LocalizedText;
  /** 规范化后的页列表（id 与导航页名），恒非空。 */
  pages: readonly [{ id: string; title: LocalizedText }, ...Array<{ id: string; title: LocalizedText }>];
  /** 当前渲染中的页 id。 */
  pageId: string;
}

interface ResolveContext {
  /** 宿主注入的 Scope；props 显式给出 input 时以 props 为准。 */
  input: ReportInput;
}

interface TextContext {
  width: number;
  locale: ReportLocale;
  render(node: ReportNode, width?: number): string;
  attemptCommand(locator: AttemptLocator): string;
}

interface WebContext {
  locale: ReportLocale;
  attemptHref(locator: AttemptLocator): string;
}

interface ComponentFaces<Props, RenderProps = Props> {
  /** 组件唯一的异步 / IO 面：把作者写下的 props 规范化成渲染 props。 */
  resolve?(props: Props, context: ResolveContext): RenderProps | Promise<RenderProps>;
  web(props: RenderProps, context: WebContext): ReactNode;
  text(props: RenderProps, context: TextContext): string;
}

/** 函数形态：组合组件，只装配已有组件，可以异步。 */
function defineComponent<Props>(
  compose: (props: Props, context: ComposeContext) => ReportNode | Promise<ReportNode>,
): ReportComponent<Props>;
/** 对象形态：双面组件，自己渲染。 */
function defineComponent<Props, RenderProps = Props>(
  faces: ComponentFaces<Props, RenderProps>,
): ReportComponent<Props>;
```

选择很简单：**只装配别人就写函数，要自己落渲染就写对象。**

**组合组件**（函数形态）覆盖「取数后用普通 JavaScript 加工再摆进现有组件」的全部场景，手感与 React 函数组件相同：

```tsx
import { AttemptList, Section, attemptListData, defineComponent } from "niceeval/report";

export const CostliestAttempts = defineComponent(async ({ limit = 10 }: { limit?: number }, ctx) => {
  const all = await attemptListData(ctx.scope);
  const ranked = [...all].sort((x, y) => (y.costUSD ?? 0) - (x.costUSD ?? 0));
  return (
    <Section title="最贵的 attempt">
      <AttemptList data={ranked.slice(0, limit)} total={all.length} />
    </Section>
  );
});

// 用的时候是普通节点：
<CostliestAttempts limit={10} />
```

组合组件在管线的 resolve 阶段展开为它返回的树，随后逐节点继续解析与校验；它不需要 text / web 面，因为它不产生自己的渲染输出。React 组件或未经 `defineComponent` 的普通函数不能进报告树，展开遇到时以完整用户反馈拒绝——这个包装就是「树中每个节点两个宿主都能判读」的资格证。

**双面组件**（对象形态）同时提供 `text` 与 `web`；可选的 `resolve` 让组件拥有自己的取数面，官方数据组件的 [spec 形态](metric-views.md)正是这样实现的：

```tsx
interface BadgeProps {
  label: LocalizedText;
  value: string;
}

export const Badge = defineComponent<BadgeProps>({
  web: ({ label, value }, ctx) => (
    <span className="nre-badge">{resolveLocalizedText(label, ctx.locale)}: {value}</span>
  ),
  text: ({ label, value }, ctx) =>
    `${resolveLocalizedText(label, ctx.locale)}: ${value}`,
});
```

缺 `web` 或 `text` 在 TypeScript 中直接报错；无类型 JavaScript 输入仍在 `defineComponent` 调用时校验。带 `resolve` 的组件在一次页渲染内按「同引用 `input` + 深相等 spec」记忆化，且 `resolve` 之后两面消费同一份渲染 props——两面同源由结构保证，不靠作者自觉。只服务自己网页的组件直接写普通 React 组件即可，但它只能住在你的页面里，进不了报告树。

## 相关阅读

- [外壳与多页](shell.md) —— 树之上的导航外壳与页。
- [指标组件](metric-views.md) —— 官方表格与图形组件的 spec / data 双形态。
- [Architecture](../architecture.md) —— 报告树的 resolve / validate / render 管线。
