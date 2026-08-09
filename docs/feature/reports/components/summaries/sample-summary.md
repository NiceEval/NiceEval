# Sample summary

`SampleSummary` 接收 executor 已交付的 Sample summary data，并用 `Grid` 与 `Stat` 显示范围摘要：

```tsx
<SampleSummary input={summary} />
```

summary 包含固定 Sample identity、coverage、MetricValue、available verification / issues、unavailable causes 和 notices。
题型与主读数选择在 plan 中完成；`Grid` 不取 Sample、不执行 Calculation，也不补造 unavailable 的数值。
