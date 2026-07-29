# `Waterfall`

`Waterfall` 接已经投影好的 `nodes`：

```tsx
const nodes = await toTraceNodes(sample);
return <Waterfall nodes={nodes} />;
```

Attempt 生命周期可以用 `toTimelineNodes(attempt)` 产生同一形状。
转换函数决定节点身份、父子关系、开始时间、时长、状态与 refs；
组件只显示这些值。

text 面输出有序时间树与精确时长；
web 面输出时间轴和可展开节点。
空间不足时允许简化几何，不得删除节点或改变总时长。
