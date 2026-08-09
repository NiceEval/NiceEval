# Attempt usage

`AttemptUsage` 接收 executor 已交付的 usage 投影；Attempt 详情、`show --usage` 与 JSON 共用同一份 ReportData entry。

## 组装口径（单源）

Usage Projector 通过 `ProjectionReadContext` 声明读取行为计数、token、请求与成本所需的 snapshot 事实，并自动形成 `basedOn`。

缺失字段保留为有依据的 unavailable，不用零或请求数 `1` 填充；页面是否隐藏该段是既有 data 的显示选择。
缓存拆分存在时明确区分 uncached input 与 cache read；available 的 verification / issues 或
unavailable 的 causes / basedOn 随该 EvidenceValue 保留。
