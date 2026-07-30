# 排版原语与自定义 renderer

page render 返回 `ReportNode`。
节点只表达内容顺序、分组与显示形状；页面的异步计算已经在返回节点前完成。

## 结构节点

`Row`、`Col`、`Section`、`Grid`、`Tabs` 与 `Markdown` 只组织子节点。
它们不接收 Sample，不读取 artifact，也不改变 MetricValue。

```tsx
return (
  <Col>
    <Section title="Quality and cost">
      <Row>
        <Scatter
          points={performance}
          x="costUSD"
          y="passRate"
          point="agent"
        />
        <Table rows={performance} />
      </Row>
    </Section>
  </Col>
);
```

页身份是 PageDefinition，不是某个组件：`render` 返回的是这一页的内容树，
页在导航与页索引里的名字来自 `PageDefinition.title`（[外壳与多页](shell.md)）。
页首要一行标题时用 `Section` 或 `Hero`，不另设页级容器组件。

`Row` 和 `Col` 表达阅读关系，不承诺固定像素几何。
text 面按终端显示列决定换行与上下排列；web 面用容器大小和主题断点排版。
两面必须保留节点顺序、标题层级、字段终值与缺数据语义。

## `Grid` 与 `Stat`

`Grid` 接 `items`，用于少量并列摘要；`Stat` 接一个 `MetricValue` 或明确的外部标量。
MetricValue 的格式化由 renderer 根据 `unit`、 `format` 与 locale 完成，作者不提前把值拼成字符串。

```tsx
<Grid
  items={[
    <Stat label="Pass rate" value={summary.passRate} />,
    <Stat label="Cost" value={summary.costUSD} />,
  ]}
/>
```

外部标量必须显式标注为 external，不能伪造 samples、total 或 Attempt refs。

`Grid` 的每格在两面都是一个格子：web 面是 grid 单元，text 面是
[数据格框](#数据格框table-与-grid)里被格线围起来的一格。

## `Table`

`Table<Row>` 接普通只读 `rows`。
列省略时按稳定字段顺序推导；覆盖列时使用字段名或列定义。

```tsx
<Table
  rows={performance}
  columns={[
    "agent",
    { field: "costUSD", label: "Spend" },
    "passRate",
  ]}
/>
```

MetricValue 单元格显示本地化数值，并保留 samples / total 与 refs 的检查入口。
普通字符串、布尔值和时间字段按各自类型显示。
不存在 `source`、`data` 或 `input` 三选一绑定。

两面都把读数关进格子：web 面输出真实 `<table>`，text 面输出
[数据格框](#数据格框table-与-grid)——外框、列边界与表头横线，格内自动折行。

## 区域框：text 面的框线体裁

终端里的线只有三种意思，画哪一种由输出形态决定，不由观感偏好决定：

| 输出形态 | 体裁 | 画什么 | 判据 |
| --- | --- | --- | --- |
| 面板 | 区域框 | 圆角外框，边框嵌标题、规模与下钻命令 | 有边界、可整体阅读的一块证据 |
| 数据格 | 数据格框 | 外框加列边界与横线，把每个读数关进自己的格子 | 内容本身是格子：表的行 × 列、`Grid` 的并列摘要 |
| 同级重复块 | 隔条 | 一条不封口的横线，左侧嵌名称与位次 | 若干平行块顺序铺开，正文各自要全宽 |
| 逐条流事件 | 无标注 | 逐条原样输出 | `list` 的 eval 清单、`sandbox stop` 的确认行、diff hunk、失败流 |

区域框声明「这一块是一份证据」，数据格框声明「这些格子构成一张表」，隔条只标注归属。
所以 `Section` 里的一张 `Table` 是两条不同的线各说一句话，不是同一句说两遍。

### 区域框（`Section`）

- **宽度**：框宽跟随调用方报告的可用列数，夹紧到 100 显示列——面板是拿来通读的，
  行太长读者会丢行。只有原地重绘、从不进入 scrollback 的动态面板声明豁免全宽，
  `exp` 的 live 面板走这一支（[`exp` 的输出形态](../../experiments/cli.md)）。
- **嵌字**：标题嵌上边框左侧，规模 / 耗时一类短 meta 嵌上边框右侧，下钻命令嵌下边框右侧。
  命令总是紧贴它能展开的那块证据。
- **截断次序**：横线先缩到最短一段；仍放不下先截标题中段补 `…`；最后才放弃 meta——
  meta 通常在正文里另有出处，标题没有。
- **嵌套**：嵌套 `Section` 不再画第二层框，降为贯穿框宽的横隔 `├─ 标题 ─┤`。
  嵌套也不吞可用宽度：每层子树按同一个内容宽度排版。

### 数据格框（`Table` 与 `Grid`）

格线画在数据的自然边界上：列与列之间、表头与正文之间、`Grid` 的行与行之间。

```text
╭──────────────────────────────────────┬───────────┬───────╮
│ Experiment                           │ Pass rate │  Cost │
├──────────────────────────────────────┼───────────┼───────┤
│ compare/codex-gpt-5.6-luna--mempal   │      100% │ $0.29 │
│   toggl-cli/04-billing-doc           │         — │ $0.03 │
│     ✓ @1nesor3r                      │         — │ $0.03 │
├──────────────────────────────────────┼───────────┼───────┤
│ compare/codex-gpt-5.6-luna           │        0% │ $0.01 │
│   toggl-cli/04-billing-doc           │         — │ $0.01 │
│     ✗ @1gy6eu6c                      │         — │ $0.01 │
╰──────────────────────────────────────┴───────────┴───────╯
```

- **宽度**：贴合内容。每列宽到放得下这一列最长的那格为止，框跟着内容收；
  可用列数是上限而不是目标，宽终端不把 `80%` 摊成半屏空白。上限本身不夹紧到 100——
  表宽由列数与读数长度决定，砍宽度就是砍列或砍字。每行的显示宽度恒等于框宽，
  右边框对齐成一条直线。
- **自动排版**：列宽先取各列内容的自然显示宽度。放不下时按自然宽的比例压缩左对齐的文本列，
  数字列不压——右对齐的读数折了行就读不成数。下限分两档：身份列（首列）取
  `min(自然宽, 24)`，其余文本列 8。身份列读不出来，这一行就等于没有，
  所以宁可少几列也不把 `compare/codex-gpt-5.6-luna` 压成 `compare/ / codex-gp`。
- **换行**：压过的格子在格内按显示宽度折行，行高取该行最高的那一格，矮格补空。
  折行保住格子开头的缩进——层级就长在那几个空格上，续行跟着对齐到同一个缩进。
  列声明的 `maxLines` 在格内收口，末行补 `…`。
- **丢列是最后手段**：所有文本列都压到各自下限仍放不下，才从右侧丢列，
  并在表下如实报出丢了几列。窄终端下宁可丢列也不转成「每条记录一块」的竖排：
  表的价值是跨行比较，块状读不出上下对齐，行数还要翻好几倍，
  而且 web 面是真 `<table>`、窄屏靠横向滚动——两面会从同一种形状分叉成两种。
  只有一条记录的场合本来就该用 `Grid` 或 `AttemptDetails`，不是把表转个方向。
- **层级与横线**：子行的层级靠首列内的缩进表达。横线画在行树自己的边界上：
  表头与正文之间一条，行树有嵌套时每个顶层行之前再一条——一组一格，组内不切。
  平表（没有任何子行）只有表头那一条，不逐行切割。
  分隔按行树深度画，所以 `Table` 认得的只是「这一行是第几层」，
  不认识 experiment、题与 attempt。
- **嵌在 `Section` 里**：不画自己的外框，只保留列边界与表头横线。
  边界已经由面板的框给出，两层框叠在一起读者只会看到噪声。

`Grid` 同一套字符与同一张宽度表：外框加列边界，行与行之间一条 `┼` 接头的横线。
格宽同样贴合内容——摘要格里是 `80%`、`$0.92` 这种短读数，格子不为占满终端而撑开；
末行不足一整行时最后一格吃掉剩余宽度（[`Grid` 与 `Stat`](#grid-与-stat)）。

### 量测与降级

宽度一律按显示列算：CJK 记 2 列，`·` `●` 这类 East-Asian-Ambiguous 字符恒记 1 列。
两族框线共用这一张表，所以面板里的表格右边框不会顶歪。

stdout 不是 TTY（agent 捕获、管道、重定向），或可用宽度窄于 60 显示列时，三种线一起消失：
面板降为标题成行加两列缩进，表与 `Grid` 降为按列对齐的纯文本，隔条降为标题行。
字段、顺序与数值在两种形态下逐字相同；线只是呈现层，脚本不解析框字符。

全仓只有一个面板渲染件产出这些物理行，落点与依赖方向见
[终端框线：一个渲染件，全仓消费](../../../cli.md#终端框线一个渲染件全仓消费)。

## `Tabs`

`Tabs` 只切换同一 page 已经产生的节点。
它不建立新的 page、路由、异步边界或缓存单位。
需要按需计算和失败隔离时，静态声明多个 PageDefinition。

tab 是选择器，不是区域：web 面那条 tab 条表达「一组互斥视角」，
text 面没有选择器，所以按声明序全量输出，每个 tab 起一条[隔条](#区域框text-面的框线体裁)、不画框。
隔条上除 tab 名还带位次，这正是 tab 条携带、而普通小标题会丢的那一份信息：

```text
── 概览 1/3 ────────────────────────────────────────────────

实验                       模型      Agent    通过率
memory/bub                gpt-5.4   bub      87.5%

── 成本 2/3 ────────────────────────────────────────────────

实验                       每题成本   Tokens
memory/bub                $0.09      112.4k
```

读者据此知道下面这段是三个平行视角之一，而不是页面的下一节内容。
位次也让「该拆页了」变得可判：`5/5` 且每段都翻屏，就该把 tab 升级成页。
tab 正文不缩进，宽表与图表在 tab 里和在页上占同样的列宽。
tab 里放 `Section` 时框由那个 `Section` 画，`Tabs` 不叠一层边界。

## 自定义 renderer

只有新增显示形状时才使用 `defineRenderer()`：

```tsx
import { defineRenderer } from "niceeval/report/extension";

export const Heatmap = defineRenderer({
  assets: {
    styles: ["./heatmap.css"],
    scripts: ["./heatmap.enhance.js"],
  },
  text(value: HeatmapValue, options, context) {
    return renderTextHeatmap(value, options, context);
  },
  web(value: HeatmapValue, options, context) {
    return <WebHeatmap value={value} options={options} />;
  },
}, import.meta.url);
```

renderer 接已计算好的普通值。
`text` 与 `web` 都是必填项；两面不能重新取数、读取 Sample 或改变终值。
若 web 交互没有诚实的 text 降级，它属于宿主能力，不是组件。

声明资产时第二个参数必须传定义文件的 `import.meta.url`；资产路径相对该文件解析。
运行时按页面实际使用情况收集、按内容哈希物化，并以稳定顺序注入。
JavaScript 只能渐进增强，不能让初始 HTML 缺失数据。

## 普通函数负责复用

复用一个动态区块时写普通函数：

```tsx
export async function costliestAttempts(
  sample: Sample,
  limit = 10,
): Promise<ReportNode> {
  const attempts = sample.attempts
    .toSorted((a, b) =>
      (attemptCostUSD(b.result) ?? 0) -
      (attemptCostUSD(a.result) ?? 0)
    )
    .slice(0, limit);

  return <AttemptList attempts={attempts} />;
}
```

调用者直接 `await costliestAttempts(sample)`。
函数参数是复用参数，Sample 是运行期输入；两者都不需要新的组件求值协议。

## 相关阅读

- [Library](../library.md) —— page render、普通转换与具体组件属性。
- [组件目录](../components/README.md) ——官方显示形状。
- [Architecture](../architecture.md) ——双面渲染、缓存与组件资产。
