# 格式化与呈现工具箱

text、web 与 JSON 共享同一份 MetricValue、EvidenceValue 和 dimension identity。
格式化只改变读法，不改变计算、coverage、basedOn、refs、causes 或 verification。

## 公开函数总表

| 分组 | 导出 | 用途 |
|---|---|---|
| 格式化 | `formatMetricValue` | 按 locale 显示 available 或 unavailable MetricValue |
| 格式化 | `formatInstant` | 显示已建立的时刻值 |
| 格式化 | `formatTimeDistance` | 显示已建立的时距 |
| 格式化 | `formatAxisTick` | 以单位和刻度显示数值轴 |
| locale | `resolveLocalizedText` | 识别 LocalizedText |
| 维度 | `presentDimension` | 为已交付 dimension 取标签与视觉身份 |
| 文本排版 | `stringWidth`、`wrapText`、`columns` | 按终端显示列排版 |

## 格式化只有一个入口

```ts
const display = formatMetricValue(metric, locale);
```

available MetricValue 依据 `value`、unit 和 format 显示数值。
unavailable MetricValue 显示状态、完整 causes、coverage 与 refs 的入口。
available 分支的 verification 为 limited 或 unverified 时，显示 issues 而不是把数值当作 full；
unavailable 分支没有 verification 字段，也不能由 formatter 合成一个。

`String(value)`、`toFixed()` 和组件私有词表都不是格式化入口。

## 时刻、轴与时距

时刻和相对时距必须来自已交付 EvidenceValue。
`formatInstant()`、`formatTimeDistance()` 与 `formatAxisTick()` 只折叠显示文本；它们不读取现在时间、Record 或浏览器状态来重算数据。

## 缺失、不适用与占位

三种状态不能互相代替：

| 形态 | 含义 |
|---|---|
| unavailable EvidenceValue | 数据或验证不可用，保留所有 causes 和 basedOn |
| excluded coverage member | 位于 Sample 分母但被声明 policy 排除 |
| not applicable | 已建立的 metric 不适用于这个显示位置 |

renderer 不选主因，不把 unavailable 变成 `—`，也不把 excluded 从分母中删除。

## 维度呈现

视觉身份按 page instance 的已交付 keyset 分配。
`dimensionPins` 可以固定槽位；未固定值按稳定 identity 分配。
颜色、线型和标签不会反向影响 group、MetricValue 或 Plan。

## 相关阅读

- [Library](../library.md#rollup与-metricvalue) —— MetricValue 和 coverage。
- [组件目录](../components/README.md) —— 两面组件输入。
- [排版原语](layout.md) —— text/web 的布局边界。
