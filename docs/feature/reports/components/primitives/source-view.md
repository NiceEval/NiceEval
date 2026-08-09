# `SourceView`

`source` 属性指已计划并投影好的标注源码值，不是惰性数据源：

```tsx
<SourceView source={source} />
```

源码 Projector 在 ReportPlan 中声明。
它的 EvidenceValue、basedOn、available verification 和预算决定在 executor 中完成；unavailable 分支
只带 causes / basedOn。renderer 不读取 Record、event 或源文件存储。

text 与 web 面保留相同源码行和标注。
web 面可以渐进增强折叠与页面定位跳转，但不能新增源码读取。
