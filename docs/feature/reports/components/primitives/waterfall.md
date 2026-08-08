# `Waterfall`

`Waterfall` 接已经投影好的 `nodes`：

```tsx
const nodes = await toTraceNodes(sample);
return <Waterfall nodes={nodes} />;
```

Attempt 生命周期可以用 `toTimelineNodes(attempt)` 产生同一形状。
转换函数决定节点身份、父子关系、开始时间、时长、状态与 refs；组件只显示这些值。

text 面输出有序时间树与精确时长； web 面输出时间轴和可展开节点。
空间不足时允许简化几何，不得删除节点或改变总时长。

## 显著性折叠：短节点折成摘要

连续短节点折成一条带计数与合计时长的摘要；失败的、测不出时长的、时长占比够大的节点直接列出，不折叠。
折叠判据只有可测显著性：失败、时长缺失与时长占比，不按 span 名维护黑白名单。
行总时长缺失时整行不折叠——没有占比基准，不猜值。
