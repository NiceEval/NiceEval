# Architecture

Experiment owner 固定 cleanupTimeoutMs，Config 只提供默认值。配置进入运行指纹与可观察配置。
Attempt owner 创建独立资源释放 scope，为 Adapter、Agent 和 Sandbox 所有 finalizer 分配一个总 deadline。
每个 finalizer 只获得剩余预算，不重置时钟。Provider 原有硬停止上限与总时段取较小值。
资源所有权从各自阶段时段改成 Attempt 总时段，必须重新审查所有 Agent 与 Sandbox 释放保证。
同一 Attempt 首次取消原因固定为 timeout 或 cancelled；执行和 cleanup signal 分离。
