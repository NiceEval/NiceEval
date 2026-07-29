# Sample traces

`toTraceNodes(sample)` 按需读取范围内的 trace artifact，
返回普通 `WaterfallNode[]`。
节点顺序、父子关系、时长、状态与 Attempt refs 在转换时确定。

`Waterfall` 只显示 nodes。
