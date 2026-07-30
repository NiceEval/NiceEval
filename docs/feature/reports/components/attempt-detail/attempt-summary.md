# Attempt 摘要

`toAttemptSummary(attempt)` 返回身份、verdict、时间、耗时、成本与得分的普通值。
默认详情用 `Stat` 与文本原语显示它。

读数格里的值都经[呈现工具箱](../../library/presentation.md#公开函数总表)折成显示字符串：
开始时刻走 `formatInstant`，耗时与成本走各自读数的格式化入口。
组件里不写 `toFixed`，也不原样打 ISO——同一个值在 `show` 与网页两处必须读法相同。
