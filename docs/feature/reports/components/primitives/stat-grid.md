# `Grid` 与 `Stat`

读数网格：一格一个「标签 + 主值 + 副说明」。范围摘要、单次 attempt 的用量与身份摘要
都是这一个形状，差别在传进去的[数据源](../sources/README.md)。

```tsx
// 默认摘要是组合组件，负责选择 snapshot 与 Measure 中的 KPI
<SampleSummary />

// 手工形态：作者自己算出终值后摆格
<Grid columns={3} variant="boxed">
  <Stat label="平均净 R / case" value="+0.479 R" detail="累计 +2.877 R" tone="positive" />
  <Stat label="Episode 胜率" value="66.7%" detail="4 / 6 cases" />
</Grid>
```

## 形状

```ts
interface GridProps {
  /** 宽面最多摆几列；必须是正整数。 */
  columns: number;
  /** plain 无框；boxed 给每个格完整四边框。默认 plain。 */
  variant?: "plain" | "boxed";
  /** 改变格内留白，并调整主值字号；不改变内容和分组。默认 regular。 */
  density?: "regular" | "compact";
  /** 每个直接子节点是一格；数据装配属于 Summary / Composition。 */
  children?: ReportNode;
  locale?: ReportLocale;
  className?: string;
}

interface StatProps {
  label: LocalizedText;
  /** 主值。收 Cell 时保住覆盖率与下钻；收标量时是作者已经算好的展示值。 */
  value: Cell | LocalizedText | number | null;
  /** 主值下面的短解释；省略时不留空行。 */
  detail?: LocalizedText;
  /** 主值的语义色；不从正负号、单位或 Measure.better 猜。默认 neutral。 */
  tone?: "neutral" | "positive" | "negative" | "warning";
  className?: string;
}
```

`value` 收 [`Cell`](../README.md#单元格类型) 是这个原语与官方数据源之间的接口：`measure` 格带着
`samples` / `total` / `refs`，所以一个读数下方能写明覆盖范围、点开能下钻到具体 attempt。
作者自己算的终值传标量即可——标量与 `text` 格等价，两者都没有证据可下钻，这是如实的。

`Grid` 的每个直接子节点是一格。数组与 Fragment 先按 `ReportNode` 规则展平，空分支不占格；
`columns` 是宽面上限，不要求子节点数量恰好为其倍数。一个格里要放多个区块时，
用 `Col` 把它们归成一个直接子节点。

## 渲染

- 每格的主值按 [`Cell` 渲染契约](table.md#单元格渲染)投影，与表格里同类格子字字相同。
- `measure` 格覆盖不全时在金额或数值下方用整句解释覆盖范围，不放无语义的比值角标。
- 时间值不直接暴露 ISO 字符串：单点写成「最近运行」，范围写成「运行范围」，
  按当前 locale 格式化到分钟；同日范围不重复右端日期，同年跨日范围不重复右端年份。
- 标签是字段名，不在标签里重复「数」「次」或「计票」；数量由值本身表达。
- text 面按显示宽度并排，装不下时整块退化为纵向堆叠，不截断、不隐藏任何格。

## 不摆空格

数据源决定哪些格出现。一个读数对当前数据不适用时，整格省略，不摆一个恒为 `—` 的格——
空格子占版面却不携带信息，读者还要先判断它是坏了还是不适用。

## 相关阅读

- [组件树](../README.md) —— 四层模型与单元格类型。
- [`Table`](table.md) —— 单元格渲染契约的落点。
- [数据源目录](../sources/README.md) —— 官方读数网格数据源。
