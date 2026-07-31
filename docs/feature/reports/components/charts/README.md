# 图表

图表接 page render 已经算好的 `points`。
`Scatter`、`Line`、`Bars` 与 `Area` 各自声明显示形状，不读取 Sample，不执行 Calculation。

## 共同输入

从 Sample 派生的每一行必须满足 EvidenceRow：

```ts
interface EvidenceRow {
  refs: readonly AttemptLocator[];
}
```

行中的读数字段使用 MetricValue。
纯外部业务序列可以使用普通数值，但必须在组件上显式声明 `external`，且不显示 Attempt 下钻。

字段属性引用 points 的对象键：

```tsx
<Scatter
  points={performance}
  x="costUSD"
  y="passRate"
  point="agent"
/>
```

字段不存在、不是可绘制类型或某行形状不一致时，错误指出组件、属性、字段与结果路径。

## `Scatter`

`Scatter` 用于两个读数的点云。
`point` 指定点身份，`series` 可选地把 points 拆成多个可见系列：

```tsx
<Scatter
  points={performance}
  x="costUSD"
  y="passRate"
  point="experiment"
  series="agent"
/>
```

点默认不连接。
质量—成本前沿由报告旁普通数组函数计算，再通过显示属性突出；它不是 `Scatter` 的计算能力。

## `Line`

`Line` 用于时间、数值参数或确有顺序的维度：

```tsx
<Line
  points={history}
  x="run"
  y="passRate"
  series="agent"
/>
```

缺点默认断线。
`connectNulls` 只改变线段，不制造 MetricValue 或零值。

## `Bars`

`Bars` 用于排行、分组与可相加的堆叠：

```tsx
<Bars
  points={ranking}
  x="agent"
  y="passRate"
  sort={{ field: "passRate", direction: "desc" }}
  limit={10}
  layout="horizontal"
/>
```

`limit` 只隐藏排序后的多余类别，不生成“其他”聚合桶。
需要合并长尾时，先在 `aggregate().by` 中定义分桶函数，让组合器从原始 Attempt 重新聚合。
`layout` 控制 web 面使用横向排行条或纵向坐标柱；默认值是 `"vertical"`。
text 面恒用横向排行条，保留分类标签、格式化终值与覆盖率。

## `Area`

`Area` 用于累计量或区间。
只有单位相同且可相加的系列才能堆叠。
缺点默认断开，不把缺失当零填满面积。

## 组合坐标图

确需在同一坐标系组合多种 mark 时使用 `ComposedChart`。
每个 series 显式声明 mark、字段与轴；多个轴必须具名，不根据单位猜测绑定。

组合图仍只消费同一份 points，不重新聚合。

## 点击目标

图表原语不决定「点开去哪」。
每种图接受一个目标函数，由放图的上层供给语义：

```tsx
<Scatter
  points={performance}
  x="costUSD"
  y="passRate"
  point="experiment"
  pointTarget={(row) => ({
    page: "experiment",
    params: { experiment: row.experiment },
  })}
/>
```

省略 `pointTarget` 时按 [`targetOfRefs()`](../../library.md#目标与下钻) 默认规则：行级 refs 恰好一个才成为 attempt 目标，多 refs 不猜。
目标经宿主 `ctx.href()` 换 URL；宿主服务不了的目标是纯图形点，不生成假链接。
`external` 图表没有 refs，也没有 `pointTarget` 属性。
原语的属性与实现里没有实体词，attempt、experiment 只出现在上层供给的目标值里。

## 值域与方向

MetricValue 的 `better` 决定“更好”朝右或朝上；未声明时不猜方向。
`bounds` 约束自然量程，renderer 在数据极值外保留呼吸边距。

tooltip、图例、轴刻度与下钻只读取 points 已有值。
locale 切换重新格式化，不重新执行 page render。

## 两面

- web 面输出真实 SVG / DOM、图例、tooltip 与证据链接；没有 JavaScript 时标签和数值仍可读。
- text 面用字符图或精确值表表达同一组 points；空间不足时保留轴、系列名与终值，不静默删除系列。
- 页级视觉身份按 `(分组字段, 完整值)` 分配；同一个 Agent 在图与表中保持相同颜色、线型或符号。

## 相关阅读

- [Library · 组件接具体值](../../library.md#组件接具体值)
- [Calculations](../../calculations.md)
- [格式化与呈现](../../library/presentation.md)
