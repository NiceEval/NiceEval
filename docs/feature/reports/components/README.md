# 组件树：原语、数据源与组合组件

报告组件分三层，每层回答一个问题。三层的名字与边界是契约：加一个能力时先判断它属于哪一层，
不在任何一层之外新造具名组件。

| 层 | 回答什么 | 数量 | 谁定义 |
|---|---|---|---|
| **原语** | 这份数据画成什么形状 | 少数几个，见下表 | niceeval，形状封闭 |
| **数据源** | 这份数据怎么算、默认怎么摆 | 一个能力一个 | niceeval 与报告作者都可以写 |
| **组合组件** | 裸跑时默认装配成什么样 | 每个宿主入口一份 | niceeval，作者照抄即可改 |

领域知识全部住在数据源里。原语只认[单元格类型](#单元格类型)与结构，不认「实验」「得分点」
「时效」这些概念——所以同一个 `Table` 既画实验对比，也画成绩单和稳定性矩阵。

## 谁认识 niceeval

三层之外还有一个不产出内容的角色:**管线**。它做的是任何单个组件都做不到的事——跨组件对齐。
四个角色各自认识什么,是这套分层的全部承重:

| 角色 | 认识 | 不认识 |
|---|---|---|
| 报告树 / page | 选哪个口径的 [Sample](../../sample/README.md)、要哪些数据源 | 格子形状、列宽、颜色 |
| 数据源 | niceeval 的全部领域概念:Sample、`AttemptHandle`、读数、时效、覆盖 | 排版、宽度、颜色 |
| 管线 | `Row` / `Cell`、这一页**全部**已解析数据 | 领域概念、磁盘 |
| 原语 | `Row` / `Cell`、自己的结构子节点 | 领域概念、磁盘、别的组件 |

**原语零领域逻辑是可达的,而且已经达到**:`niceeval/report/react` 只导出原语的纯 web
renderer 与数据类型,吃可序列化 `data`,不碰磁盘、不认识 `AttemptHandle`。同一批原语换一个
数据源就画另一件事。

**领域逻辑挪不进报告树。** 「让 page 自己算完、原语只剩样式」这条两层方案不成立,三个各自
独立的原因:

- **`refs` 是领域判断。** 「哪些 attempt 落进这一格」决定 `Cell` 的证据链,而覆盖范围跟随
  格子而不是有效样本(`samples < total` 时读者仍要能下钻到测不了的那几条)。这是「数字能回到
  证据」的承重墙,不是取数细节。
- **官方口径会分叉。** 数据源是官方数字与自定义页共用的同一段计算;各 page 自己算,两边迟早
  给出不同的数,而报告的用处正建立在数字可复算之上。
- **耦合不会消失,只会搬家。** 数据源产出的 `Row` / `Cell` 形状与原语一一对应;page 自己拼
  这个形状,耦合就从库内搬进每个 page,还失去类型背书。

**跨组件逻辑挪不进数据源。** 数据源只看得见自己那份数据,所以下面这三件必须住在管线里:
[页级色分配](#系列色分配单位是页)(图例里的 `codex` 与列表里的 `codex` 同色)、标签缩写互斥
(同页两个 experiment id 不能缩成一样)、text 面宽度自适应(先按可用宽度定列数,再以各格内容
宽度调 `ctx.render`)。它们都要求「先看完这一页的全部数据」,任何单个组件都拿不到这个视野。

### 加一个能力时,三问定位它属于哪层

1. **它要读磁盘,或要认识 `AttemptHandle` / 读数 / 时效 / 覆盖吗** → 数据源。
2. **它要看这一页**其它**组件的数据吗** → 管线。别的都不是管线的活。
3. **两个都不要** → 原语,而且大概率是已有原语的一个 `Column` 或 `Cell` kind。

判据的用处是拦住两类提案:「给原语加一个领域字段」(第 1 问命中,该进数据源)与「让数据源读
主题色或终端宽度」(第 2 问命中,该进管线)。

图表族不走 `Row` / `Cell`——它的通用词汇是 series / axis / point。`chart(...)` 是数据源，
`Chart` 是唯一原语，mark 住在 Content；系列色仍由管线按页分配。

```tsx
<Table source={experimentRows} filter />
```

这一行拿到的是完整的实验对比表：列、列序、题型切换、三级下钻、覆盖缺口占位行与时效标注
全部来自 `experimentRows` 这个数据源。要改列就写 `<Column>` 子节点覆盖默认列，不换组件。

## 原语总表

这张表是「有哪些渲染形状」的单点声明。原语的集合是封闭的：新能力先找已有原语，
找不到才提新原语，并说明它渲染的是哪一类既有原语表达不了的形状。

| 原语 | 渲染什么 | 结构子节点 |
|---|---|---|
| [`Table`](primitives/table.md) | 行 × 列，行可递归下钻 | `Column` |
| [`Grid` / `Stat`](primitives/stat-grid.md) | 标签 + 主值的读数网格 | 无（`Grid` 的子节点是格） |
| [`Callouts`](primitives/callouts.md) | 分级提示条目，可按 lifecycle 分组折叠 | 无 |
| [`Waterfall`](primitives/waterfall.md) | 时间树与瀑布，可逐层展开 | 无 |
| [`SourceView`](primitives/source-view.md) | 带标注的源码：逐行着色、行内展开、分数标注 | 无 |
| [`Conversation`](primitives/conversation.md) | 分轮事件流卡片 | 无 |
| [`DiffView`](primitives/diff-view.md) | 文件清单与可展开 patch | 无 |
| [`CopyBlock`](primitives/copy-block.md) | 可复制的整块文本 | 无 |
| [`Chart`](charts/README.md) | 折线、柱状、面积、散点与混合图 | 无 |
| [排版原语](../library/layout.md#排版原语) | 组织上面这些的容器与散文 | 各自声明 |

站点身份件 [`Hero` / `HeroCard` / `PoweredBy`](site/README.md) 不在这张表里：它们渲染的是
品牌与站点身份，不是数据投影，形状本身就是契约。

## 单元格类型

`Table` 的一格、`Stat` 的一个主值都是同一个判别联合。它是原语与数据源之间的**全部**接口——
原语按 `kind` 渲染，数据源负责把领域事实折成这几种格子之一。

```ts
type Cell =
  /** 官方读数格：display 是格式化结果，samples / total / refs 保住覆盖率与下钻。 */
  | { kind: "measure"; measure: MeasureCell }
  /** 判定：单个 verdict，或 passed / failed / errored / skipped 的计票。 */
  | { kind: "verdict"; verdict?: Verdict; counts?: VerdictCounts }
  /** 挣分：earned 恒有；possible 只有固定题集这类有分母的读数才给。 */
  | { kind: "score"; earned: number; possible?: number }
  /** 单行结果摘要，more 是「还有几条没显示」。 */
  | { kind: "summary"; text: LocalizedText; more?: number }
  /** attempt 身份；staleSinceMs 存在即历史执行，渲染成时距标注。 */
  | { kind: "locator"; locator: AttemptLocator; staleSinceMs?: number }
  /** 身份或自由文本，detail 是副行。 */
  | { kind: "text"; text: LocalizedText; detail?: LocalizedText }
  /** 这一格不适用（通过制行的总分格）：与「测不了」严格分开。 */
  | { kind: "notApplicable" }
  /** 覆盖缺口：没有任何 attempt，command 是可复制的补跑命令。 */
  | { kind: "missing"; reason: LocalizedText; command?: string };
```

每个 `kind` 的两面渲染在[`Table` 的单元格渲染契约](primitives/table.md#单元格渲染)一处声明，
所有原语照抄同一份，不各自即兴。三条不变量跨原语成立：

- **`measure` 格永远带证据。** 数据源不得把 `MeasureCell` 压成字符串塞进 `text` 格——
  压了就丢掉 `samples` / `total` / `refs`，读者看到一个数却点不开它是从哪几条 attempt 来的。
- **`notApplicable` 与 `missing` 不合并。** 前者是「这个读数对这一行没有意义」，
  后者是「本该有却没跑到」；合成一个空格子，覆盖缺口就从表里消失了。
- **`summary` 的文本已经折好。** 摘要按 [Scoring display 契约](../../scoring/library/display.md#主失败断言怎样选)
  在数据源里算完，渲染面只做宽度截断，不重算。

## 数据源

数据源把「怎么取数、怎么聚合、默认摆成什么样」打成一个具名值。原语收它，或收它算好的数据。

```ts
interface TableContent<Row extends Row = Row> {
  rows: readonly Row[];
}

interface RowSource<Row extends Row, Input = Sample>
  extends DataSource<TableContent<Row>, Input> {
  name: string;
  /** 省略 <Column> 时用的默认列。收已解析的行，所以按数据切换列的判断住在这里。 */
  columns(rows: readonly Row[]): readonly ColumnSpec[];
}

interface Row {
  key: string;
  cells: Readonly<Record<string, Cell>>;
  /** 下钻子行；层数由数据源决定，原语只按声明渲染。 */
  subRows?: readonly Row[];
  /** placeholder 是覆盖缺口占位行：渲染成行，但不参与任何列的聚合读数。 */
  variant?: "normal" | "placeholder";
}
```

`columns()` 收已解析的行，是因为列集合可以随数据变：实验对比表的主读数列按
[题型构成](../library/measures.md#题型构成与主读数)在通过率与总分之间切换，两型并存时两列都出。
这个判断在数据源里做一次，原语与作者都不重复它。

官方数据源与它们各自的形状见[数据源目录](sources/README.md)。作者自己写一个数据源与用官方的
没有形态差别——`RowSource` 是公开接口，不是内部约定。

## 数据绑定与两种形态

数据来源二选一，以传进去的是数据源还是数据判别：

```ts
type PrimitiveProps<Content, Input, Presentation> =
  | ({ source: DataSource<Content, Input>; input?: Input; evals?: string | readonly string[] } & Presentation)
  | ({ data: Content; source?: never; input?: never; evals?: never } & Presentation);
```

- **source 形态**：传数据源，管线在 resolve 阶段代调它的 `compute`；`input` 省略时取当前 page
  注入的同类型输入。与「先手工调 `compute` 再传 `data`」严格等价。
- **data 形态**：传算好的可序列化数据，原语不再取数。此时结构子节点只按 key 选择已算好的部分
  并附加呈现，不能再出现取数字段。
- 同时给出 `data` 与 `source` 时按完整用户反馈报错，不静默取一边。

`niceeval/report` 导出原语、数据源与组合组件；`niceeval/report/react` 只导出纯 web 渲染面，
那里的同名原语只有 data 形态。完整模型见 [Architecture · 组件模型](../architecture.md#组件模型解析面与渲染面)。

`evals` 是 source 形态唯一的数据过滤选项：eval id 前缀，与 CLI 位置参数同语义，
在聚合**之前**收窄题集。聚合发生在 `compute` 内部，事后 JavaScript 无法从聚合值还原题级过滤，
所以它必须是选项。逐实体成行的数据源不消费它：那种数据的聚合边界就是单实体，
取数后用普通 JavaScript 过滤与任何选项严格等价。

## 结构节点

结构节点是只携带 props、没有独立渲染面的 JSX 节点，由**最近的合法拥有者**解释。它不是
[`ReportNode`](../library/layout.md#树的节点reportnode)：它不进入「每个节点必须有 text 和 web 两面」
的资格校验，也不能脱离宿主原语单独出现在报告树里。

```text
原语
├── 绑定节点        声明这个原语从哪取数（轴、列、series）
│   └── 局部节点    只作用于父绑定的配置（标签、误差、单项覆盖）
└── 呈现节点        属于原语整体的呈现件（网格、图例、tooltip、参考标注）
```

结构节点位置接受与 [`ReportNode`](../library/layout.md#树的节点reportnode) 相同的展平规则：
数组与 Fragment 按声明顺序展平，`null` / `undefined` / `false` 是空分支。所以
`{ids.map((id) => <Column key={id} … />)}` 与 `{showCost && <Column dataKey="cost" />}` 都直接可用，
一组列不需要另一套批量语法。展平在校验父子关系之前完成——数组不构成一层父级。

每类结构节点显式声明**合法直接父原语集合**。当前数据原语里只有 `<Column>` 绑定
`TableContent` 的列 key；图表绑定已经进入 `chart(...)` 数据源声明。

三条判据决定什么成为结构子节点，命中任一条就是子节点，都不命中就是 props：

1. **同型条目的列表**——原语要收 N 个同型声明（多根轴、多条 series、多列）。
   列表用子节点表达，不用数组 prop：每个条目因此有自己的位置挂局部配置。
2. **局部作用域的配置**——只作用于某个子部分的设置（某条 series 的误差线、某根轴的标签）。
   它挂在所属节点下，不做成容器上的 `Record<string, ...>` 侧表：侧表要靠键字符串对齐，
   读的人必须在两处之间跳着看才知道谁配了谁。
3. **可变的嵌套关系**——条目自己还要分组。

留在 props 的是：整个原语唯一的标量口径（`evals`、`sort`、`limit`）、呈现开关
（`filter`、`locale`、`className`、`attemptHref`），以及**契约固定、没有选择余地的部分**。

## 组合组件

组合组件是具名的默认装配：`niceeval show` 与 `niceeval view` 裸跑时，`pages[].content` 必须指向
一个具体值，「照抄这棵树」不能作为一个值，所以它得有名字。

组合组件只装配已有原语，自己不渲染任何东西，也**不接受结构子节点**——覆盖的方式是不用它，
直接把那棵树写进 `Col` 并逐块增删。每份组合组件的文档给出等价全文，照抄即可改。
这样「这份组合组件会渲染什么」永远只有一个答案，不存在「给了子节点走一套、不给走另一套」
的两份语义。

| 组合组件 | 装配成什么 |
|---|---|
| [`SampleOverview`](summaries/sample-overview.md) | 范围摘要 + 成本 × 主读数散点 + 实验对比表 |
| [`AttemptDetail`](attempt-detail/attempt-detail.md) | 一次 attempt 的全部区块，按内建顺序 |
| [`AttemptAssessment`](attempt-detail/attempt-assessment.md) | 错误 → 源码 → 断言，三选一的判定视图 |
| [`FailureList`](entity-lists/failure-list.md) | 取数 → 过滤出失败 → attempt 表 |

组合组件可以自带 compose 阶段的解析——按题型选主读数、按 `labels` 推散点归类维度、
混型时把范围拆成两组各出一份。这类解析属于「默认装配怎么定」，与原语的渲染面无关。

## 共用呈现 props

所有数据原语共享同一组呈现 props，各篇不逐个重复：

| Prop | 作用 |
|---|---|
| `attemptHref?: (locator: AttemptLocator) => string` | 证据引用的链接目标。当前报告声明了 [attempt-input page](attempt-detail/README.md) 时宿主自动注入；自有 React 页面显式传入。没有链接目标时 locator 两面都只渲染成文本，宿主不追加隐藏 fallback |
| `locale?: ReportLocale` | 原语自带文案的语言；省略时随宿主 |
| `className?: string` | 挂在根元素上的 web 类名 |
| `filter?: boolean` | 只给 web 面增加过滤输入框的渐进增强；不改变数据与 text 面。只有声明了它的原语才有这个开关 |

证据下钻只有 `attemptHref` 一个入口：图上的点、表里的格、列表的行都把自己的 `MeasureCell.refs`
逐个交给它，不为「一个点对应多个 attempt」另发明一个收整行的回调。单个 ref 时渲染成直接链接，
多个 ref 时进 tooltip / 展开区逐条列出。

数组顺序只有两类：作者显式写下的结构子节点保留声明顺序；从数据发现的维度 domain 按稳定 key
字典序。原语级排序是稳定排序，同值时仍以 key 收口。这个规则适用于 text、web 和写出的 JSON，
不让文件扫描顺序渗进报告。

## 系列色：分配单位是页

同一个维度值在一页里恒定一个颜色。读者在同一页上先看图例、再看表格里的同名键，
两处颜色必须是同一个——所以颜色的分配单位不是原语，是**页**。

- **色只按 `(维度, 维度值)` 分配**，不按原语、不按显示名。实验对比表的行标签缩成最短唯一后缀
  不影响颜色：键仍是完整值。
- **分配在 resolve 之后、render 之前一次完成**：收集这一页已解析数据里出现的全部 `(维度, 值)` 对，
  得到每个维度的页内 keyset；[外壳钉住](../library/shell.md#钉色)的键先原样占位，
  其余键以稳定散列为起点，同一 keyset 内撞色时按显示键字典序线性探测下一个空色格，
  keyset 超过色板容量才复用。它是确定的纯函数，不改变任何数据源，不进入序列化数据。
- **颜色键可以与位置键不同**：一行是「agent 线 × 记忆机制」，颜色要说的却是记忆机制。
  这由 `Chart` 的 series 呈现覆盖声明——它取的仍是这一页 `(该维度, 该值)` 的颜色，
  因此与页上任何按同一维度取色的地方一致。
- **页内全部消费者读同一份映射**：图表 series 与图例、表里的 agent 键、矩阵的行列头，
  同一个键在这一页恒同色。所有原语都读这一份——渲染面的
  [`ctx.seriesColor(dimension, value)`](../library/layout.md#系列色) 是它唯一的入口，
  自己按键算色会绕开页内消解，与官方原语对不上。
- **跨页与跨报告让位给页内可辨**：稳定散列保证 keyset 不冲突时跨页同色；发生冲突时以页内可辨为准。
  读者跨页比较靠的是标签，页内比较靠的才是颜色。
- text 面不消费颜色映射，无 ANSI 时输出仍自足。

## 双面投影边界

数据、聚合口径、排序、轴值域与证据在 text / web 两面同源；默认呈现也有明确的两面投影——
web 的 tooltip 对应 text 的证据摘要，web 的误差须线对应 text 数值后的区间。

呈现定制沿用同一个阶梯：

```ts
type WebRenderer<Props> = ReactNode | ((props: Props) => ReactNode);
type TextRenderer<Props> = LocalizedText | ((props: Props) => LocalizedText);

type Presentation<Props, Defaults> =
  | false
  | Partial<Defaults>
  | WebRenderer<Props>
  | { web: WebRenderer<Props>; text: TextRenderer<Props> };
```

- `false`：关闭该呈现。
- 部分属性对象：保留默认语义，只覆盖样式或位置。
- ReactNode / 函数：只接管 web 面；text 面继续默认投影，两面内容可能不同。
- `{ web, text }`：同时接管两面，用于标签、tooltip 或图例等有内容语义的定制。

渲染回调只收到解析后的只读数据片段与呈现 context，不能触发第二次聚合。这条边界保证计算同源，
不对任意 React 回调承诺无法验证的内容等价。

text 面允许把有稳定 CLI 选择器的大块内容折成摘要加命令，但不能改变判定、计数、可用性或引用。
专用 `--source` / `--execution` / `--timing` / `--diff` 是 Record evidence 的深度终端投影，
不是另一套数据。折叠形态由数据源声明，原语照它渲染。

## 不引入的机制

- 原语词汇同构不意味着渲染实现相同：两面渲染由 niceeval 自己实现，静态 SVG、终端字符图、
  证据链接与无浏览器首屏都是它的职责，不把第三方图表运行时或 React context 引入生成管线。
  唯一的例外是 [`Markdown`](../library/layout.md#markdown) 的 CommonMark 解析器——
  它产出一棵 AST 供两面各自投影，不参与渲染。
- 不引入 `ResizeObserver` 或视口测量；响应式由静态 HTML 的 CSS Grid 与 container query 承担。
- 结构节点不独立取数：一个原语的全部读取与聚合由它的一次 resolve 完成并记忆化。
- facet 用 JSX `map` + [`Grid`](../library/layout.md#grid-与-stat) 表达，
  原语不重复实现语言已有的遍历能力。
- 不为「某个数据源画出来长得不一样」新增原语：形状相同、内容不同的东西共用一个原语，
  差异写进数据源的默认列与单元格类型。

## 相关阅读

- [`Table`](primitives/table.md) —— 单元格渲染契约的落点，其余原语照抄同一份。
- [数据源目录](sources/README.md) —— 官方数据源与它们的行形状。
- [组合组件](summaries/README.md) —— 裸跑默认装配的等价全文。
- [图表](charts/README.md) —— 容器、轴、series 与嵌套节点。
- [Gallery](gallery.md) —— 真实报告图的结构验证。
- [读数与维度](../library/measures.md) —— 数据源消费的 Measure、Dimension 与 NumericAxis。
- [排版原语与自定义组件](../library/layout.md) —— 原语之间的组织件与 `defineComponent`。
- [Architecture](../architecture.md) —— resolve / validate / render 管线与两面同源不变量。
