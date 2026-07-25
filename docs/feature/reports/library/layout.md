# 排版原语与自定义组件

`Row`、`Col`、`Grid`、`Section`、`Stat`、`Text`、`Markdown`、`Style`、`Tabs`、`Tab` 和 `Table` 是十一个内置双面排版组件，用于组织报告树。其中 `Tab` 与 `Table` 的 `Column` 是[结构子节点](../components/README.md#结构节点)，只在各自的父组件下成立。

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

十一个原语的公开形状是：

```ts
interface LayoutProps {
  children?: ReportNode;
  className?: string;
}

type RowProps = LayoutProps;
type ColProps = LayoutProps;

interface GridProps extends LayoutProps {
  /** 宽面最多摆几列；必须是正整数。 */
  columns: number;
  /** plain 无框；boxed 给每个 cell 完整四边框。默认 plain。 */
  variant?: "plain" | "boxed";
  /** 改变格内留白，并调整内置 Stat 的主值字号；不改变内容和分组。默认 regular。 */
  density?: "regular" | "compact";
}

interface SectionProps extends LayoutProps {
  title: LocalizedText;
  /** 标题右侧的短元信息；text 面嵌在区域框上边框右侧，空间不足时最先被舍弃。 */
  meta?: LocalizedText;
}

interface StatProps {
  label: LocalizedText;
  /** 已格式化的主值；null 明确渲染为 —，不补成 0。 */
  value: LocalizedText | number | null;
  /** 主值下面的短解释；省略时不留空行。 */
  detail?: LocalizedText;
  /** 主值的语义色；不从正负号、单位或 Metric.better 猜。默认 neutral。 */
  tone?: "neutral" | "positive" | "negative" | "warning";
  className?: string;
}

interface TextProps {
  /** 自由正文原样渲染，一个标记都不解析。作者写下几种语言就有几种，组件不翻译。 */
  children: LocalizedText | number;
  className?: string;
}

interface MarkdownProps {
  /** CommonMark 正文。作者写下几种语言就有几种，组件不翻译。 */
  children: LocalizedText;
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

`Text` 与 `Markdown` 的正文按 [`LocalizedText`](shell.md) 的回退规则随宿主语言切换：报告站有语言切换按钮，切完一整页英文中间夹一段中文方法学说明是坏结果。收 `LocalizedText` 不等于自动翻译——作者写下几种语言就有几种，缺的语言走回退链；指标与聚合口径不因 locale 改变，`MetricCell.display` 仍是同一个 `value` 的几种格式化。

`Col` 在两个面都按声明序纵向排列。`Row` 的 web 面横排；text 面在可用宽度装得下全部子块时按显示宽度并排（与下文 `columns` 工具同一把尺），装不下时整块退化为纵向堆叠——不截断、不隐藏任何子块。`Grid` 与 `Stat` 的布局和降级规则见下一节。

## `Markdown`

报告里的散文——方法学、口径说明、脚注、免责声明——用 `Markdown` 写，不用把每一段拆成一串 `Text`：

```tsx
<Markdown>{`
## 方法学

每个配置跑 **3 轮**，取端到端通过率。成本按网关实测优先，估算兜底。

- 题集固定为 \`security/\` 下 12 题，未跑到的题按 0 分留在分母
- 超时 attempt 的耗时记 \`null\`，不计入均值

详细口径见[指标说明](https://example.com/metrics)。
`}</Markdown>
```

正文按 [CommonMark](https://spec.commonmark.org/) 解析，另启用 GFM 的删除线、任务列表与 autolink。解析在 resolve 之前完成，产出一棵 AST；text 与 web 两面各自从**同一棵 AST** 投影，不是 web 先渲染 HTML、text 再解析第二遍。这是报告面唯一的解析依赖，也是它值得引入的理由：CommonMark 的边界情况（嵌套列表、惰性续行、行内优先级）自己实现只会得到一份似是而非的方言。

两面投影：

| Markdown | web 面 | text 面 |
|---|---|---|
| 段落 | `<p>` | 按可用宽度折行，段间空一行 |
| `#`–`######` 标题 | `<h1>`–`<h6>`（挂 `nre-md-*` 类） | 空行 + 标题文字，支持颜色时加粗；不进导航，也不参与 `Section` 的嵌套计数 |
| 列表（含嵌套、任务列表） | `<ul>` / `<ol>` / 复选框 | `- ` / `1. ` / `[ ]`、`[x]`，每层缩进两格 |
| 围栏与缩进代码块 | `<pre><code>` | 缩进两格原样输出，**不折行**——折行的代码不能复制执行 |
| 块引用 | `<blockquote>` | 每行 `> ` 前缀 |
| 强调 / 删除线 / 行内代码 | `<strong>` / `<em>` / `<del>` / `<code>` | 支持颜色时用 ANSI，不支持时脱去标记只留文字 |
| 链接与 autolink | `<a rel="noopener">` | `文字 (url)`；文字与 url 相同时只打一次 |
| 图片 | `<img>` | `alt (url)`——终端画不出图，但不吞掉这条信息 |
| 分割线 | `<hr>` | 一行 `─`，宽度取可用宽度 |

三条边界：

- **不透传裸 HTML。** CommonMark 允许的 HTML 块与行内 HTML 一律转义成可见文本。报告是要发布出去的静态站，正文里的字符串可能来自结果数据，解析器不给它开一条注入通道。
- **不解析 Markdown 表格。** 遇到表格语法（`|` 起首行加分隔行）按完整用户反馈报错，指引改用 [`Table`](#table)：表格的列宽要走终端显示宽度那把尺子（CJK 记 2 列、身份列下限、超宽先折行再丢列并如实标注），Markdown 表格绕过这套只会在终端撕歪。
- **不解析证据引用。** 正文里的 `@1k2m9qrs` 就是普通文本，不会变成 attempt 深链——要证据链接就用数据组件，它们的 locator 有真正的下钻目标。

折行与宽度量测和其它排版原语共用同一把尺（`stringWidth` / `wrapText`，CJK 与全角记 2 列），所以中文正文在终端不会撕歪。`Markdown` 只排版，不取数、不读 Scope：内容从哪来是普通 JavaScript 的事——字面量、`readFile` 读一份 `METHODOLOGY.md`、或组合组件里按数据拼串都可以。

需要一个标记都不解析的正文时用 `Text`：两者的分工就是「有格式的散文」与「这段字原样打」。

`Style` 注入的 CSS 是页级全局的：树位置只决定声明顺序，不限定作用域；text 面零输出。它服务树形态文件与自带样式的组件——配置对象形态的报告要全站样式优先用外壳 [`styles`](shell.md)，两条通道注入同一增强层、遵守同一不变量。

```tsx
// reports/nightly.tsx —— 排版原语组织报告树的完整文件形态
import {
  Col, Column, MetricTable, Row, Rows, Section, Style, Text,
  costUSD, defineReport, endToEndPassRate,
} from "niceeval/report";

export default defineReport(
  <Col>
    <Text className="team-note">nightly benchmark · publishes at 06:00</Text>
    <Row>
      <Section title="Overall">
        <MetricTable>
          <Rows dimension="agent" sort={endToEndPassRate} />
          <Column metric={endToEndPassRate} />
          <Column metric={costUSD} />
        </MetricTable>
      </Section>
      <Section title="Cost">
        <MetricTable>
          <Rows dimension="agent" sort={costUSD} />
          <Column metric={costUSD} />
          <Column metric={endToEndPassRate} />
        </MetricTable>
      </Section>
    </Row>
    <Style>{`.nre .team-note { color: #6b7280; }`}</Style>
  </Col>,
);
```

本页其余示例都是这样一棵报告树中的片段；更多完整文件按场景收在[配方](recipes.md)。

## `Grid` 与 `Stat`

`Grid` 是自由摘要面板的格子容器，`Stat` 是其中最常见的 label / 主值 / 辅助信息内容。二者只负责呈现，不读取 Scope、不聚合 Metric，也不定义领域口径；报告作者从结果或自有数据算出终值后，把已格式化内容放进 `Stat`。需要 niceeval 代算指标、保留 `samples` / `total` / `refs` 时继续使用[表格与矩阵](../components/tables.md)或[图表](../components/charts.md)，不能为了得到这种外观把 `MetricCell` 降成几段丢失证据的字符串。

`Grid` 的每个直接子节点是一格。数组与 Fragment 先按 `ReportNode` 规则展平，空分支不占格；`columns` 是每行的宽面上限，不要求子节点数量恰好为其倍数。一个格子里要放多个区块时，用已有 `Col` 把它们归成一个直接子节点：

```tsx
// reports/run-overview.tsx
import { Col, Grid, Section, Stat, defineReport } from "niceeval/report";

export default defineReport(
  <Section title="运行总览" meta="6/6 完成 · 31 笔完整交易">
    <Grid columns={6} variant="boxed">
      <Col>
        <Stat
          label="平均净 R / case"
          value="+0.479 R"
          detail="累计 +2.877 R"
          tone="positive"
        />
        <Stat
          label="单笔期望"
          value="+0.093 R"
          detail="已成交交易"
          tone="positive"
        />
      </Col>

      <Col>
        <Stat label="Episode 胜率" value="66.7%" detail="4 / 6 cases" />
        <Stat label="MFE / MAE" value="0.87 / 0.71" detail="捕获 4.3%" />
      </Col>

      <Col>
        <Stat label="交易胜率" value="41.9%" detail="13 / 31 笔" />
        <Stat label="持有 / 回撤" value="1.5 / 1.47 R" detail="bars / max DD" />
      </Col>

      <Col>
        <Stat label="方向命中" value="66.7%" detail="cutoff → horizon" />
        <Stat label="完成率" value="100.0%" detail="6 / 6" />
      </Col>

      <Col>
        <Stat label="Profit Factor" value="1.29" detail="盈利 R / 亏损 R" />
        <Stat label="执行成本" value="$1.09" detail="0 bps" />
      </Col>

      <Col>
        <Stat label="参与 / 成交" value="100.0% / 100.0%" detail="6 个方向订单" />
        <Stat label="耗时 / 首次决策" value="207.4 s / B0.8" detail="34.7 tools · 84927 tokens" />
      </Col>
    </Grid>

    <Grid columns={9} variant="boxed" density="compact">
      <Stat label="初始 1H" value="0 bars" />
      <Stat label="初始日线" value="250 bars" />
      <Stat label="初始周线" value="104 bars" />
      <Stat label="回放窗口" value="— sessions" />
      <Stat label="回放 1H" value="20 bars" />
      <Stat label="首次决策" value="B0 起自主决定" />
      <Stat label="待成交窗口" value="— bars" />
      <Stat label="强平提醒" value="T-5 → T-1" />
      <Stat label="长桥日 / 周回填" value="0 / 0" />
    </Grid>
  </Section>,
);
```

行为边界如下：

- `Grid` 的格子可以是任意 `ReportNode`，不限定为 `Stat`；`Stat` 也可以脱离 `Grid` 单独使用。`Grid` 是排版机制，不是新的数据或领域容器。
- `columns` 必须是有限正整数；TypeScript 的 `number` 不能排除 0、负数、小数、`NaN` 或 `Infinity`，因此组件创建时统一做运行时校验并给完整用户反馈。`variant` 默认 `"plain"`，`density` 默认 `"regular"`。
- `density` 只控制当前 Grid 的 cell padding、gutter，以及其中内置 `Stat` 的既定字号档；它不向任意自定义组件注入样式或改写子节点 props。
- `Stat.label`、字符串形态的 `value` 与 `detail` 都按 `LocalizedText` 回退规则选择语言并转义输出；number 形态按当前 locale 格式化。`null` 与数字 `0` 严格区分，前者显示 `—`，后者正常显示为零。
- `tone` 是作者给主值的语义判断：`positive` / `negative` / `warning` 分别使用官方 success / danger / warning token，`neutral` 使用正文 token；组件不看正负号、单位、verdict 或 `Metric.better` 自动猜 tone。
- `Stat` 不接受格式串、HTML、`ReportNode` detail 或 locator。长正文、链接和证据下钻属于其它组件；Metric 值应先由指标引擎产生完整 `MetricCell`，不能把这个纯样式件当成另一条聚合捷径。

`Section.meta` 是标题的短补充，不是第二个正文槽：web 面在标题行右对齐；text 面嵌进区域框的上边框右侧（见下）。它不接受 `ReportNode`，长说明仍放进 Section 的 `children`。

## 区域框：text 面的框线体裁

这一节是全仓终端框线的单一契约。`show` 的证据区块、自定义报告的 text 面、`exp` 的 [live 面板与结束面板](../../experiments/cli.md#框线体裁)、[`sandbox` 命令组的一次性面板](../../sandbox/cli.md#niceeval-sandbox查看与销毁留存的沙箱)都按它渲染，别处只引用不复述。哪些输出画框由体裁判断，与哪条命令无关：面板（有边界、可整体阅读的区块）画框，流事件（逐条到达、条数不可预知）不画框。物理实现同样单源——全部消费方经同一个[面板渲染件](../../../cli.md#终端框线一个渲染件全仓消费)取得框线，不各自拼字符。

**框标记区域，不标记条目。** `Section` 在 text 面渲染为一个圆角框：`title` 嵌上边框左侧，`meta` 嵌上边框右侧。逐条到达且条数不可预知的东西（失败流、日志行、diff hunk）不画框——每条一个框只会把输出变成框的堆叠。

**嵌套只画最外层。** 顶层 `Section` 画完整四边框，嵌在其中的 `Section` 降为带标题的横隔 `├─ 标题 ─┤`，用它的 `title` 作隔条标题、`meta` 右对齐在同一条隔条上。框不嵌套，可用宽度因此不被逐层吞掉：

```text
╭─ 运行总览 ────────────────────────────────── 6/6 完成 ─╮
│ …顶层正文…                                             │
├─ Cost ─────────────────────────────────────────────────┤
│ …嵌套 Section 的正文…                                  │
╰────────────────────────────────────────────────────────╯
```

**几何。** 框宽跟随终端宽度，上限 100 显示列——上限是给进入 scrollback 的面板定的阅读宽度；原地重绘、从不进入 scrollback 的动态面板（`exp` 的 live 面板）由调用方声明豁免上限、跟随终端全宽（声明见 [Experiments CLI · 框线体裁](../../experiments/cli.md#框线体裁)）。左右边框各占 1 列、各留 1 格 padding，所以子节点拿到的可用宽度是框宽减 4；`Grid` 的列数规划、`Text` 的折行都按这个数计算——**行内容与外框必须按同一个框宽计算**，调用方不得自行按终端裸宽度排行。可见高度受限时先减少可见条目、再截断行，不换行撑高。

**终端宽度的来源按优先级取**：调用方显式传入的宽度 → `COLUMNS` 环境变量 → TTY 实测宽度 → 80 兜底。`COLUMNS` 排在实测之前，且**不因为输出不是 TTY 就被忽略**：管道、CI 日志与 `tee` 到文件的场景下终端实测拿不到宽度，显式声明的 `COLUMNS=200` 正是读者唯一能表达「按这个宽度排」的手段——降级成无框纯文本(见下)与按 80 列排版是两件事，不得混为一谈。

**上下边框先保证嵌入文字完整**：横线可以缩到最少一段；缩到头仍放不下时先截断标题中段、补 `…`，最后才放弃 `meta`——`meta` 通常在正文里另有出处，标题没有。

**降级。** 终端窄于 60 显示列、输出不是 TTY，或 `NO_COLOR` 一类的朴素输出要求生效时，整套框线降级为无框纯文本：`title` 单独成行、`meta` 跟在同一行右侧、正文缩进两列，内容与分节顺序一字不变。框只是呈现层，不携带任何契约信息，绝不向非 TTY 写框字符、ANSI 或光标序列。

**量测。** 行宽按显示列而不是码点数计算，统一走 `stringWidth`；CJK / 全角记 2 列，East-Asian-Ambiguous（`·` `●` `…` `×` `✓` `✗`）一律记 1 列。渲染与量测必须用同一张宽度表，否则同一份输出在 ambiguous=wide 的 locale 下会把每一条右边框顶歪。

**圆角框标区域，直角框标数据格。** `Grid` 的 `variant="boxed"` 给每个 cell 的 `┌─┐` 是直角（见下），与区域框的圆角区分开：一眼能看出哪一层是结构、哪一层是数据。框只由这两个排版原语产生——数据组件（榜单、散点、列表、瀑布）自身永不画框，页面上有没有面板完全由组件树里有没有 `Section` 决定，要面板就把组件包进 `Section`。包不包框的判据是成本收益：框的收益是分隔并列的异质区域、给参差不齐的正文（断言列表、时间树、live 重绘的进度）一条稳定边界；成本是 4 列可用宽度、行首行尾的框字符污染整行复制、与内容自带的结构线叠成双重线。表格的列对齐、散点的坐标轴本身就是边界，独占整页时包框只有成本——[内建报告](built-in.md)的三张导航页因此整树无 `Section`、text 面无框铺开；`AttemptDetail` 这类页面正文参差且多区域并列，面板在那里才买得到东西。

### `view` 输出

`view` 的 web 面把 `Grid` 渲染为 CSS Grid。宽面采用声明的最大列数；容器变窄时按每格最小 inline size 自动减少列数，不产生页面级横向滚动，也不截断格子。`variant="boxed"` 给**每个 Grid cell 自己的完整四边框**，cell 之间保留 density 对应的 gap；它不是靠相邻项凑出来的一组半边框，所以换行后不会出现缺左边、缺底边或双线。`Col` 本身无框：嵌套在同一 cell 中的两个 `Stat` 仍是一张卡里的两个纵向区块。

上例的初始 HTML 结构如下；省略号只省略重复的 cell，不代表运行时省略内容：

```html
<section class="nre nre-section">
  <header class="nre-section-header">
    <h2 class="nre-section-title">运行总览</h2>
    <p class="nre-section-meta">6/6 完成 · 31 笔完整交易</p>
  </header>

  <div class="nre nre-grid nre-grid--boxed nre-grid--regular"
       style="--nre-grid-max-columns: 6">
    <div class="nre-grid-cell">
      <div class="nre nre-col">
        <div class="nre nre-stat nre-stat--positive">
          <div class="nre-stat-label">平均净 R / case</div>
          <div class="nre-stat-value">+0.479 R</div>
          <div class="nre-stat-detail">累计 +2.877 R</div>
        </div>
        <div class="nre nre-stat nre-stat--positive">…单笔期望…</div>
      </div>
    </div>
    <div class="nre-grid-cell">…Episode 胜率 / MFE / MAE…</div>
    <div class="nre-grid-cell">…交易胜率 / 持有 / 回撤…</div>
    <div class="nre-grid-cell">…方向命中 / 完成率…</div>
    <div class="nre-grid-cell">…Profit Factor / 执行成本…</div>
    <div class="nre-grid-cell">…参与 / 成交 / 耗时 / 首次决策…</div>
  </div>

  <div class="nre nre-grid nre-grid--boxed nre-grid--compact"
       style="--nre-grid-max-columns: 9">…9 个完整 cell…</div>
</section>
```

稳定契约是结构、类名、完整文本和最大列数事实，不是上面为说明而出现的省略号或具体空白。label / value / detail 全部按 inline-start 对齐；label 与 detail 使用弱化文本层级，value 使用 tabular numerals。`tone` 只落在 value，`positive` 不会把 label 和 detail 一并染色。`value={null}` 显示 `—`；字符串 `"— sessions"` 是作者明确写下的领域文案，组件不拆解或重格式化。

### `show` 输出

`show` 的 text 面保留同样的 cell 顺序与分组。renderer 从 `min(columns, cell 数)` 开始向一列尝试，选出满足最小可读内容宽度的最大列数；一列是无条件 fallback。规划先扣掉边框、cell 内左右各一格 padding 与格间 gutter，再把剩余显示列均分，不能用字符串码元数或“看起来差不多”的空格。整除余数从左向右各补一列，因此任意一行都不会超出 `ctx.width`。

字段统一按 label → value → detail 输出并左对齐。三者都用 `stringWidth` / `wrapText` 按显示宽度折行，CJK / 全角记 2 列；detail 省略时不留占位行。一个物理 Grid row 中的 cell 顶对齐，较短 cell 在底部补空行到同高；`Col` 内的第二个 Stat 只跟同 cell 的第一个 Stat 相邻，不承诺与其它 cell 内第 N 个任意子组件建立跨格 baseline。需要严格的跨格行基线时，应把那些项声明成另一层 Grid row，而不是依赖 Grid 猜子树结构。

`variant="boxed"` 在 text 面也给每个 cell 独立的 `┌─┐ / │ │ / └─┘` 四边框，同行 box 之间留 gutter，换成下一排时重新起完整 box；不拼只在当前列数成立的半框或交叉线。`plain` 使用相同的列数和宽度计划，只去掉 cell 边框与 padding。任何 cell、label、value 或 detail 都不因宽度被隐藏。

上例在**恰好 100 显示列**、无 ANSI 控制序列的终端中会降成三列。Section 的区域框占掉左右各两列，所以 Grid 收到 96 列可用宽度，三格分到 31 / 31 / 30；下面每一行经 `stringWidth` 计量都恰好是 100：

```text
╭─ 运行总览 ──────────────────────────────────────────────────────────── 6/6 完成 · 31 笔完整交易 ─╮
│ ┌─────────────────────────────┐  ┌─────────────────────────────┐  ┌────────────────────────────┐ │
│ │ 平均净 R / case             │  │ Episode 胜率                │  │ 交易胜率                   │ │
│ │ +0.479 R                    │  │ 66.7%                       │  │ 41.9%                      │ │
│ │ 累计 +2.877 R               │  │ 4 / 6 cases                 │  │ 13 / 31 笔                 │ │
│ │                             │  │                             │  │                            │ │
│ │ 单笔期望                    │  │ MFE / MAE                   │  │ 持有 / 回撤                │ │
│ │ +0.093 R                    │  │ 0.87 / 0.71                 │  │ 1.5 / 1.47 R               │ │
│ │ 已成交交易                  │  │ 捕获 4.3%                   │  │ bars / max DD              │ │
│ └─────────────────────────────┘  └─────────────────────────────┘  └────────────────────────────┘ │
│                                                                                                  │
│ ┌─────────────────────────────┐  ┌─────────────────────────────┐  ┌────────────────────────────┐ │
│ │ 方向命中                    │  │ Profit Factor               │  │ 参与 / 成交                │ │
│ │ 66.7%                       │  │ 1.29                        │  │ 100.0% / 100.0%            │ │
│ │ cutoff → horizon            │  │ 盈利 R / 亏损 R             │  │ 6 个方向订单               │ │
│ │                             │  │                             │  │                            │ │
│ │ 完成率                      │  │ 执行成本                    │  │ 耗时 / 首次决策            │ │
│ │ 100.0%                      │  │ $1.09                       │  │ 207.4 s / B0.8             │ │
│ │ 6 / 6                       │  │ 0 bps                       │  │ 34.7 tools · 84927 tokens  │ │
│ └─────────────────────────────┘  └─────────────────────────────┘  └────────────────────────────┘ │
│                                                                                                  │
│ ┌──────────────────────────────┐ ┌─────────────────────────────┐ ┌─────────────────────────────┐ │
│ │ 初始 1H                      │ │ 初始日线                    │ │ 初始周线                    │ │
│ │ 0 bars                       │ │ 250 bars                    │ │ 104 bars                    │ │
│ └──────────────────────────────┘ └─────────────────────────────┘ └─────────────────────────────┘ │
│                                                                                                  │
│ ┌──────────────────────────────┐ ┌─────────────────────────────┐ ┌─────────────────────────────┐ │
│ │ 回放窗口                     │ │ 回放 1H                     │ │ 首次决策                    │ │
│ │ — sessions                   │ │ 20 bars                     │ │ B0 起自主决定               │ │
│ └──────────────────────────────┘ └─────────────────────────────┘ └─────────────────────────────┘ │
│                                                                                                  │
│ ┌──────────────────────────────┐ ┌─────────────────────────────┐ ┌─────────────────────────────┐ │
│ │ 待成交窗口                   │ │ 强平提醒                    │ │ 长桥日 / 周回填             │ │
│ │ — bars                       │ │ T-5 → T-1                   │ │ 0 / 0                       │ │
│ └──────────────────────────────┘ └─────────────────────────────┘ └─────────────────────────────┘ │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
```

终端不输出颜色词或 `positive` 标签；支持颜色时只把主值着色，不支持颜色时文本仍自足。`regular` 的同行 box gutter 是 2 显示列，`compact` 是 1；两者的最小可读**内容**宽度都是 24 显示列，density 不以挤坏字段换取更多列。`density` 只收紧 cell padding、格间 / 排间留白，不合并 label 和 value，也不改变声明分组。

## `Tabs`

把一页里的并列视图组织成可切换的块。tab 是页内浏览状态，不是数据边界，也不是宿主寻址单位——需要能从 CLI 单独打开、有自己路由和导航项的块，用[页](shell.md)而不是 tab。tab 不进 `defineReport` 的配置对象：把 tab 提到定义层，它就会被追问 id、深链和 CLI 选择器，页与 tab 的边界就塌了。

```tsx
<Tabs>
  <Tab title="质量 × 成本">
    <ScatterChart>
      <XAxis metric={costUSD} />
      <YAxis metric={endToEndPassRate} />
      <Scatter points="experiment" by="agent" x={costUSD} y={endToEndPassRate} />
    </ScatterChart>
  </Tab>
  <Tab title="分科得分">
    <Scoreboard score={examScore}>
      <Rows dimension="agent" />
      <Question id="security/sql-injection" />
      <Question id="correctness/retry" />
    </Scoreboard>
  </Tab>
</Tabs>
```

- 两个渲染面都输出全部 tab 的完整内容。web 面静态 HTML 把每个 tab 渲染为独立 `<details>`，第一个默认展开；渐进增强把它们变成单选 tab 条。切换是纯浏览状态，不改变数据、指标口径或初始 HTML 中的数值。text 面按声明顺序把每个 tab 输出为带标题的分节。
- `Tabs` 必须至少含一个直接 `Tab` 子节点，`Tab` 也只能直接放在 `Tabs` 下；空 Tabs、普通组件混作直接子节点或游离 Tab 在树校验期给出完整用户反馈。tab 内容内部仍可放任意 `ReportNode`。
- `Tab` 除通用 `children` / `className` 外只有 `title: LocalizedText`。tab 不参与路由，没有 id，也没有 CLI 选择器。
- **text 面不给 tab 做索引，也不隐藏任何 tab。** 页能用命令下钻，tab 没有选择器，索引只能是死路，所以 `show` 全量输出。多 tab 报告在终端长到读不动，是把这些 tab 升级成[页](shell.md)的信号。

## `Table`

自定义表格的标准件：列是 `<Column>` 结构子节点，行是 `rows` 数据；text 面按显示宽度对齐、web 面输出 `<table>`。列是声明、行是数据，这条分工与[官方表格](../components/tables.md)一致。

```tsx
<Table
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
>
  <Column key="eval" header="题目" />
  <Column key="pass" header="通过率" align="right" />
  <Column key="cost" header="成本" align="right" />
</Table>
```

```ts
interface TableColumnProps {
  key: string;
  header: LocalizedText;
  align?: "left" | "right";
  maxLines?: number;
}

interface TableRow {
  key: string;
  cells: Readonly<Record<string, string | null>>;
  locator?: AttemptLocator;
}

interface TableProps {
  /** 至少一个 <Column>；声明顺序即渲染顺序。 */
  children: ColumnNode | readonly ColumnNode[];
  rows: readonly TableRow[];
  locale?: ReportLocale;
  className?: string;
}
```

`TableProps`：

| Prop | 类型 | 含义 |
|---|---|---|
| `children` | `<Column>` 子节点 | 非空列定义；声明顺序即渲染顺序 |
| `rows` | `readonly TableRow[]` | 行数据；数组顺序即渲染顺序 |
| `locale` | `ReportLocale` | 组件自带文案的语言；省略时随宿主 |
| `className` | `string` | web 面挂在 `<table>` 上 |

`Column`：

| 字段 | 类型 | 含义 |
|---|---|---|
| `key` | `string` | 取 `row.cells[key]` 的键 |
| `header` | `LocalizedText` | 表头文案，按渲染 locale 选择 |
| `align` | `"left" \| "right"` | 默认 `"left"`；`"right"` 按显示宽度右对齐，数字列用 |
| `maxLines` | `number` | text 面数据格折行后的最大物理行数，省略则不限行数；只约束数据格，表头不受约束，web 面不消费——网页的高度约束是组件自己的 CSS 决定 |

`TableRow`：

| 字段 | 类型 | 含义 |
|---|---|---|
| `key` | `string` | 行身份 |
| `cells` | `Record<string, string \| null>` | 已格式化的显示值 |
| `locator` | `AttemptLocator` | 可选；带上就多一列 attempt |

渲染契约：

- **列宽按显示宽度算**，CJK / 全角记 2 列。中文列不会撕歪。
- **列 key 与行 key 都必须唯一。** `cells` 出现未声明的 key 以完整用户反馈报错；缺少已声明 key 则按 `null` 处理。零个 `<Column>`、`<Column>` 出现在 `Table` 之外，或 key 重复，都在树校验期给出完整用户反馈。
- **`null` 渲染成 `—`**，不补 0；`cells` 里缺这个键同样是 `—`。
- **超宽先折行再丢列。** 总宽超过可用列宽时，先压最宽的左对齐列（按显示宽度折行）；右对齐列不折行——数字折行读不了。左对齐列压到下限仍放不下，就从右侧丢列，并在表下如实标注丢了几列。
- **身份列压不到不可读。** eval id、experiment id 与 `locator` 是读者要复制去执行下一条命令的可操作字段，它们的下限是 24 显示列（`locator` 是它的完整长度）：其余列都压到各自下限后仍放不下，就按上一条从右侧丢列，绝不把身份列挤成几个字符。窄到连一列身份都放不下时，表格整体降级成每行一条身份的纵向清单——宁可只剩身份，不留一张读不出是谁的表。
- **`maxLines` 只收口数据格的物理行数。** 折行后超出 `maxLines` 的行丢弃，末行按显示宽度以 `…` 收口；表头不受约束，省略 `maxLines` 的列不收口。web 面不消费这个字段——网页里格子的高度是组件自己的 CSS 决定，不是 `Table` 的职责。
- **两个面各自成立。** text 面列间 3 空格、首行表头；web 面是 `<table>` + `<thead>` / `<tbody>`，右对齐落成 `nre-align-right` 类，不用内联样式。
- **带 `locator` 的行只携带证据引用，不强造详情。** 有任一行带 `locator` 时多出一列 attempt：当前报告声明了 attempt-input page（或自有 React 页面显式传 `attemptHref`）时，web 面渲染链接、text 面渲染带完整报告上下文的命令；没有连接目标时两个面都只显示 locator 文本，宿主不追加隐藏 fallback。

`MetricTable`、`MetricMatrix`、`Scoreboard`、`DeltaTable` 与 `StabilityMatrix` 的 text 面建在 `Table` 上：自定义表和官方表用同一把尺子。

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
  /** 宿主选择的 Scope；页组件直接消费，attempt 组合也可用来读站点范围。 */
  scope: Scope;
  /** 结果根完整读取面；历史视图从这里自行挑 Snapshot[]。 */
  results: Results;
  /** 规范化后的报告声明，只读；见下方 ReportMeta。 */
  report: ReportMeta;
  /** 当前 page 及其输入；非法组合由判别联合排除。 */
  page: PageContext;
}

type PageContext =
  | { id: string; input: "scope" }
  | { id: string; input: "attempt"; locator: AttemptLocator; evidence: AttemptEvidence };

interface ReportMeta {
  /** 走完回退链（声明 title → 唯一快照 name → 内置文案「Eval 运行结果」）后的标题。 */
  title: LocalizedText;
  /** 页头外链；声明省略时为空数组。 */
  links: readonly ReportLink[];
  footer?: LocalizedText;
  /** 规范化后的 page 列表，包含不进导航的参数化 page，恒非空。 */
  pages: readonly [{ id: string; title: LocalizedText; input: "scope" | "attempt"; navigation: boolean }, ...Array<{ id: string; title: LocalizedText; input: "scope" | "attempt"; navigation: boolean }>];
}

interface ResolveContext {
  /** 宿主注入的 Scope；props 显式给出 input 时以 props 为准。 */
  input: ReportInput;
  /** Attempt 详情组件从 attempt 分支读取 evidence；scope 组件不猜可选字段。 */
  page: PageContext;
}

interface TextContext {
  width: number;
  locale: ReportLocale;
  render(node: ReportNode, width?: number): string;
  /** 当前定义有 attempt-input page 时存在；否则 locator 只渲染成文本。 */
  attemptCommand?: (locator: AttemptLocator) => string;
  /** 「按实验收窄」类命令；宿主注入以携带完整 --results / --report / --page 上下文。 */
  experimentCommand(experimentIdPrefix: string): string;
}

interface WebContext {
  locale: ReportLocale;
  /** 当前定义有 attempt-input page 或嵌入方显式接外部路由时存在。 */
  attemptHref?: (locator: AttemptLocator) => string;
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

**双面组件**（对象形态）同时提供 `text` 与 `web`；可选的 `resolve` 让组件拥有自己的取数面，官方数据组件的 [spec 形态](../components/README.md#数据绑定与两种形态)正是这样实现的：

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
- [组件树](../components/README.md) —— 官方组件的结构子节点、spec / data 双形态与共用呈现 props。
- [Architecture](../architecture.md) —— 报告树的 resolve / validate / render 管线。
