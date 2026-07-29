# `DiffView`

`DiffView` 接已经投影好的文件差异：

```tsx
const files = await toDiffFiles(attempt);
return <DiffView files={files} />;
```

文件顺序、路径、二进制标记、截断与缺失事实来自转换结果。
组件不读取 artifact，也不重新计算 patch。

text 面使用统一 diff；web 面输出逐文件语义 DOM。
两面保留相同增删内容与截断边界。
