# `SourceView`

这里的 `source` 属性指待显示的标注源码值，不是惰性数据源：

```tsx
const source = await toAttemptSource(attempt);
return <SourceView data={source} />;
```

组件显示文件、行号、调用边界与断言标注。
投影预算和 `--source=full` 在转换函数中决定；renderer 不读取 AttemptEvidence 或 sources.json。

text 与 web 面保留相同源码行和标注。text 面对 `gate-fail`、`soft-fail` 与 `unavailable`
源码行，在状态行后逐条输出其有界详情；unmapped 详情也逐条输出。它不能只报 tone。legacy
Judge 的 rationale、reason 与 evidence 都是人读诊断的一部分，但必须是有界预览，不能将完整
evidence 或 Turn 默认倾倒进终端。
web 面可以渐进增强折叠与页面定位跳转。
