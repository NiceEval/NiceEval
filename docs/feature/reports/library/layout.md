# 排版原语与自定义 renderer

page render 返回 `ReportNode`。
节点只表达内容顺序、分组与显示形状；页面的异步计算已经在返回节点前完成。

## 结构节点

`Page`、`Stack`、`Row`、`Col`、`Section`、`Grid`、`Tabs` 与 `Markdown` 只组织子节点。
它们不接收 Sample，不读取 artifact，也不改变 MetricValue。

```tsx
return (
  <Page title="Quality and cost">
    <Row>
      <Scatter
        points={performance}
        x="costUSD"
        y="passRate"
        point="agent"
      />
      <Table rows={performance} />
    </Row>
  </Page>
);
```

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

## 区域框：text 面的框线体裁

框线是 `Section` 的能力，不是任何数据组件的能力。
`Table`、`Scatter` 这类组件两面都只负责对齐与终值，边界装饰由外层 `Section` 决定；
所以同一张表放进 `Section` 有框、直接铺在页上无框，两面一致。

### 画框资格

| 输出形态 | 体裁 | 判据 |
| --- | --- | --- |
| 面板 | 画框 | 有边界、可整体阅读的一块证据，需要在边框上标注归属与规模 |
| 同级重复块 | 隔条 | 若干平行块顺序铺开，读者要知道「这是 m 个之一」，但正文各自要全宽 |
| 逐条流事件 | 无标注 | `list` 的 eval 清单、`sandbox stop` 的确认行、diff hunk、失败流 |

隔条是一条贯穿可用宽度的横线，左侧嵌名称与位次（`── 概览 1/3 ─────`），上下不封口。
它标注归属而不声明边界：正文一字不动地全宽铺开，逐行仍可复制、可直接喂给 `git apply` 一类工具。
`Tabs` 的每个 tab、`--diff` 的每个窗口用这一支。

宽表与图表不为统一观感而框化：一套框吃掉左右各 2 列，
而默认报告首页的实验表与散点要占满可用列宽（形态见[默认报告](../show/default-report.md)）。

### 几何

- **宽度**：框宽跟随调用方报告的可用列数，夹紧到 100 显示列。只有原地重绘、
  从不进入 scrollback 的动态面板可以声明豁免全宽——`exp` 的 live 面板走这一支
  （[`exp` 的输出形态](../../experiments/cli.md)）。
- **嵌字**：标题嵌上边框左侧，规模 / 耗时一类短 meta 嵌上边框右侧，下钻命令嵌下边框右侧。
  命令总是紧贴它能展开的那块证据。
- **截断次序**：横线先缩到最短一段；仍放不下先截标题中段补 `…`；最后才放弃 meta——
  meta 通常在正文里另有出处，标题没有。
- **嵌套**：嵌套 `Section` 不再画第二层框，降为贯穿框宽的横隔 `├─ 标题 ─┤`。
  嵌套也不吞可用宽度：每层子树按同一个内容宽度排版。
- **量测**：宽度按显示列算，CJK 记 2 列，`·` `●` 这类 East-Asian-Ambiguous 字符恒记 1 列。

### 降级

stdout 不是 TTY（agent 捕获、管道、重定向），或可用宽度窄于 60 显示列时，
整体降级为无框纯文本：标题成行、meta 跟在同一行右侧、正文缩进两列。
字段、顺序与数值在两种形态下逐字相同；框只是呈现层，脚本不解析框字符。

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
