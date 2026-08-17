# 并行 Invocation 追加同一 Record

## 解决什么问题

两条写 Invocation 可以同时使用同一份代码、Experiment 和 Record root。每个 Run writer 只排他创建自己唯一的
`runs/<RunId>/`，因此 Record 不需要 revision、写合并或跨进程接管；只读命令仍只查看已经发布的 Run。

两个终端可以指向同一个 root：

```bash
niceeval exp compare --record .niceeval/record --max-concurrency 2
niceeval exp compare --record .niceeval/record --max-concurrency 2
```

每条命令独立规划、建立 Run、写 Attempt 并返回 receipt。两个并发上限各自生效；每个已封口 Run 都进入同一
Record，之后由 analysis selection（分析选择）决定 Sample 与 Report 的范围。

## 同一 root 怎样协作

终端 A 和 B 不会因同一 root 互相报 busy。它们只能读取已创建 `complete` 的 Run；对方还在写的目录始终
incomplete（未发布不完整），不会被读取、展示或沿用。

每条 Invocation 用 weak scan（弱扫描）形成自己的计划。A 在 B 扫描期间封口的 Run 可以整体被 B 看到，
也可以留给 B 的下一次运行；没有一次扫描承诺全局快照。`show`、`view` 与 `exp --dry` 也遵守这条规则。

是否让两个 Invocation 派发同一 logical slot，由 Coordination 的 execution deduplication（执行去重）和
dispatch claim（派发占用）决定。它们使用 `.niceeval/` 的本地状态，不读取另一个 writer 的目录或 local build。

有效 owner 仍在运行时，等待方把占位显示为运行状态。owner 被强杀且 heartbeat 过期时，等待方接管本地
协调状态并继续派发；成功接管属于恢复信息，不形成 warning。完整输出见[恢复中断运行](恢复中断运行.md)。

## 外部共享状态

同一或不同 Record root 的 Invocation 都可能访问同一数据库或 checkpoint。此时 `sharedState.key` 只保护
那份外部状态的生命周期；它不合并选择集，也不把未发布 Attempt 作为 carry 候选。

## 边界

- `--max-concurrency` 与 Experiment `maxConcurrency` 都只约束本 Invocation。
- Sandbox handle 与复用池不跨 Invocation。
- 同一 root 的 writer 可以并发追加；每个 `complete` 只发布一个完整 Run。
- reader 的 weak scan 只惰性读取已发布 Run，可能只看到并发 Invocation 的一部分 Run。
- `clean` / `migrate` 的 maintenance lease 仍排他；它们不能与 append writer 或 reader 交错。

## 相关阅读

- [并发 Invocation 架构](../../architecture.md#并发-invocation)
- [缓存与 Attempt 采用](../../cache.md#并发-invocation)
- [限制全局并发](限制全局并发.md)
