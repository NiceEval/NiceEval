---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 并行 Invocation 独立发布 Run

## 解决什么问题

两条 Invocation 可以同时使用同一份代码和 Experiment，并各自创建 Run、独立发布 Attempt。只读命令在固定 `PublicationCutoff` 下查看已创建 Run 和已发布 Attempt。

两个终端可以并发执行：

```bash
niceeval exp compare --max-concurrency 2
niceeval exp compare --max-concurrency 2
```

每条命令独立规划、建立 Run、发布 Attempt 并返回 receipt。两个并发上限各自生效；之后由 receipt 的 `createdRunIds` 与 `publicationCutoff` 固定读取范围。

## 并发 publication 怎样协作

终端 A 和 B 的 Run create 一经提交就可见。已发布 Attempt 也不等 Run 收口就能被读取，并可在当次 policy 复核后 carry 或 accept。`active` Run 未绑定的 expected slot 显示 `pending`。

每条 Invocation 在 planning 开始时固定 cutoff。该 cutoff 之后发布的 Attempt 留给下一次 planning；`query`、`view` 与 `exp --dry` 也使用同样的固定边界。

是否让两个 Invocation 派发同一 logical slot，由 Coordination 的 execution deduplication（执行去重）和
dispatch claim（派发占用）决定。它们使用唯一 `.niceeval/record.sqlite` 的 case-lock rows，不读取另一个 writer 的目录或 local build。

有效 case-lock owner 仍在运行时，等待方把占位显示为运行状态；只有精确 process identity 已终止并完成 generation-fenced recovery，
case lock 才能由新 owner 取得。`sharedState.key` 同样不使用 heartbeat expiry、TTL 或 PID 自动接管：它的等待方保持阻塞，直到 owner 正常完成完整生命周期，或
操作员按[恢复中断运行](恢复中断运行.md#sharedstate-显式恢复)显式确认 terminated/quiesced 后运行一次补偿 teardown。

## 外部共享状态

不同 Invocation 都可能访问同一数据库或 checkpoint。此时 `sharedState.key` 只保护
那份外部状态的生命周期；它不合并选择集，也不把未发布 Attempt 作为 carry 候选。

最后 Attempt settle 后，Runner 冻结 reusable pool registry。它等待 Sandbox lifecycle/finalizer scope（其中也等待
provider finalizer）和 Experiment teardown 完成后才释放。任一 cleanup 失败会留下可公开检查、显式恢复的 owner evidence。

## 边界

- `--max-concurrency` 与 Experiment `maxConcurrency` 都只约束本 Invocation。
- Sandbox handle 与复用池不跨 Invocation。
- Run create 后立即可见；每个 Attempt publication 独立提交。
- reader 在固定 cutoff 下读取，可能只看到并发 Invocation 的一部分 publication。
- Run close 只冻结终态与 absence reasons，不发布或撤销既有 Attempt。

## 相关阅读

- [并发 Invocation 架构](../../architecture.md#并发-invocation)
- [缓存与 Attempt 采用](../../cache.md#并发-invocation)
- [限制全局并发](限制全局并发.md)
