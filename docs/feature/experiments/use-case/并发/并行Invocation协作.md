# 并行 Invocation 使用不同 Record

## 解决什么问题

两条写 Invocation 可以同时使用同一份代码和 Experiment，但不能同时写同一个 Record root。这样 Record 不需要 revision、写合并或跨进程接管；只读命令仍可查看已经发布的 Run。

为两个进程指定不同 root：

```bash
niceeval exp compare --record .niceeval/record-a --max-concurrency 2
niceeval exp compare --record .niceeval/record-b --max-concurrency 2
```

每条命令独立规划、建立 Run、写 Attempt 并返回 receipt。两个并发上限可以同时生效，但两个 Record 的 Run、Sample 和 Report 不会自动合并。

## 同一 root 怎样反馈

若终端 B 也运行 `exp` 并指向终端 A 正在写的 root，B 在规划前以 `record-writer-busy` 失败：

```text
error: Record writer is busy: .niceeval/record
fix: wait for the active writer, or choose another --record root
```

B 不等待、不认领剩余 Eval、不读取 A 的 local build，也不在 A 完成后自动重试。`show`、`view` 或 `exp --dry` 可以同时打开 lock-free reader；它们只看到 A 已经原子发布的完整 Run。

## 外部共享状态

不同 Record root 仍可能访问同一数据库或 checkpoint。此时 `sharedState.key` 只保护那份外部状态的生命周期；它不合并 Record，也不把另一个 root 的 Attempt 作为 carry 候选。

## 边界

- `--max-concurrency` 与 Experiment `maxConcurrency` 都只约束本 Invocation。
- Sandbox handle 与复用池不跨 Invocation。
- 同一 root 的 writer 彼此互斥，reader 可并发；reader 的 weak scan 可能只看到一次 Invocation 的部分 Run。
- 要比较两个独立 Record，使用各自的 Sample/Report；Record 不提供局部 Run 合并或跨 Record Sample。

## 相关阅读

- [并发 Invocation 架构](../../architecture.md#并发-invocation)
- [缓存与 Attempt 采用](../../cache.md#并发-invocation)
- [限制全局并发](限制全局并发.md)
