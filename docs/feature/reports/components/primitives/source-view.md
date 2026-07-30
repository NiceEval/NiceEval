# `SourceView`

这里的 `source` 属性指待显示的标注源码值，不是惰性数据源：

```tsx
const source = await toAnnotatedEvalSource(attempt);
return <SourceView source={source} />;
```

组件显示文件、行号、调用边界与断言标注。
投影预算和 `--source=full` 在转换函数中决定；renderer 不读取 AttemptEvidence 或 sources.json。

text 与 web 面保留相同源码行和标注。
web 面可以渐进增强折叠与锚点跳转。
