# Library：Experiment 统一收尾预算

候选二为 Experiment 增加 cleanupTimeoutMs，Config 提供默认，配置优先级为 Experiment → Config → 30000 ms。
范围为整数 1 至 300000 ms，非法输入在发现阶段失败。所有 Adapter 使用同一字段，不另加实现选项。

AdapterCreateContext.signal 使用 AttemptSignal，reason 为冻结的 timeout 或 cancelled 判别联合。
timeout 带 timeoutMs、source 与 Unix 毫秒 deadlineAt；未取消时为 undefined。
AdapterCleanupContext 提供 signal、timeoutMs、deadlineAt，整个 Attempt 共用独立资源释放时段。
导出从 niceeval 与 niceeval/adapter 提供，不增加 Turn 或 within。
