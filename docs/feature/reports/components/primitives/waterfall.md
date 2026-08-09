# `Waterfall`

`Waterfall` 接收 timing Projector 已生成的 `nodes`：

```tsx
<Waterfall nodes={nodes} />
```

节点 identity、父子关系、开始时间、时长、状态、basedOn 与 verification 都在 executor 中建立。
组件只显示这些值，不读取 trace、Sample 或 Store。

text 面输出有序时间树，web 面输出时间轴和可展开节点。
显著性折叠只改变显示密度：失败、无时长或显著节点保留，连续短节点可折成带准确计数的摘要。

缺失 timing evidence 保留 unavailable EvidenceValue，不能由组件按总耗时补造节点。
