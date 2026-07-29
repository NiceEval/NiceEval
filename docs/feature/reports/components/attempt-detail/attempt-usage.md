# Attempt usage

`usageResult(attempt)` 是 Attempt 详情、`show --usage` 与 JSON 共用的任务结果。
行为计数来自事件流，token 与请求来自落盘 Usage，成本来自相同 Attempt 事实。

缺失字段整段省略，不用零或请求数 `1` 填充。
缓存拆分存在时明确区分 uncached input 与 cache read。
