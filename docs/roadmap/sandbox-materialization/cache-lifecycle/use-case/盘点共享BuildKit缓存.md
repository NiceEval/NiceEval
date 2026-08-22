# 盘点共享 BuildKit 缓存

用户看到 Provider 报告 BuildKit cache 占用 402.6GB，其中 221.6GB 标记为 reclaimable，希望知道 NiceEval 能否安全回收。

## 只读容量观察

共享或默认 builder 没有 NiceEval 专属的 builder identity、managed storage epoch、registry、lease 和 root。
NiceEval 因此只显示 provider-level observation：

```text
BuildKit · unverified shared-builder capacity
total 402.6 GB · provider reclaimable estimate 221.6 GB
NiceEval ownership unknown · not eligible for NiceEval GC
```

这组数字不进入 Materialization Domain inventory，不取得 domain id，也不出现在 entry、evictable 或 GcPlan 中。
`reclaimable` 是 Provider 估算，不是 NiceEval 的 exact marginal reclaim。

## 用户自行回收

CLI 可以展示不带 `--force` 的 Provider 命令，但不会执行、持久化或 apply 它。
反馈必须同时说明 NiceEval 无法把 cache record 归因给自己，命令可能影响其它项目、builder session 和正在进行的 build。

Sandbox orphan、受管 task-build image 和共享 BuildKit cache 分成三个区块：

- Sandbox orphan 继续提示用户运行 `niceeval sandbox prune`；
- 受管 task-build image 使用 NiceEval 两阶段 GcPlan；
- 共享 BuildKit cache 只有未验证容量观察和用户自担风险的 Provider 路径。

任何统一的 `Docker cleanup` 汇总都不能暗示一次 NiceEval apply 可以安全回收三类资源。

## 成为受管 Domain 的条件

未来只有专属 managed builder 同时提供稳定 Domain identity、durable registry、lease/root、fencing 和 conditional delete，BuildKit 才能采用 NiceEval 两阶段 GC。
repository、image tag、record 年龄和 `docker system df` 输出都不能替代这些所有权与活跃引用证明。
