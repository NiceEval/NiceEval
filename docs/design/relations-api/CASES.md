# Cases

| ID | 输入 | 必须观察到的结果 |
|---|---|---|
| R1 | 一个 send 对应多个 spans | `many` 返回完整 collection，不误报 ambiguous |
| R2 | operation 缺少 durable send anchor | local fact 保留为 unmatched，不按时间邻近补关系 |
| R3 | projections 来自不同 Sample handles | 整次 relation 构造返回 typed input error，不产生半套 rows |
| R4 | 声明 `one` 的 edge 找到多个 targets，同时另有 dangling anchor | 前者是 ambiguous，后者是 unmatched；合法 `many` 不误报 |
