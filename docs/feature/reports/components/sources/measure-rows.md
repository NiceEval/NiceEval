# 分组读数 rows

用 `aggregate()` 的 `by` 对象声明分组字段，用 `values` 声明 Calculation：

```ts
const rows = await aggregate(sample, {
  by: { agent },
  values: { passRate, costUSD },
});
```

结果可直接交给 Table、Scatter、Bars 或普通 JavaScript。
