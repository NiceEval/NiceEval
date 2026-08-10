# 并行 Invocation 使用不同 Record

## 解决什么问题

两条 Invocation 可以同时使用同一份代码和 Experiment，但不能同时打开同一个 Record root。这样 Record 不需要 revision、写合并、运行中快照或跨进程接管。

为两个进程指定不同 root：

```bash
niceeval exp compare --record .niceeval/record-a --max-concurrency 2
niceeval exp compare --record .niceeval/record-b --max-concurrency 2
```

每条命令独立规划、建立 Run、写 Attempt 并返回 receipt。两个并发上限可以同时生效，但两个 Record 的 Run、Sample 和 Report 不会自动合并。

## 同一 root 怎样反馈

若终端 B 指向终端 A 正在使用的 root，B 在规划前以 <code>record-root-busy</code> 失败：

```text
error: Record root is busy: .niceeval/record
fix: wait for the active operation, or choose another --record root
```

B 不等待、不认领剩余 Eval、不读取 A 尚未停稳的 Attempt，也不在 A 完成后自动重试。A 结束且目录重新停稳后，用户可以再次运行命令，让 planner 从当时的当前数据重新规划。

## 外部共享状态

不同 Record root 仍可能访问同一数据库或 checkpoint。此时 <code>sharedState.key</code> 只保护那份外部状态的生命周期；它不合并 Record，也不把另一个 root 的 Attempt 作为 carry 候选。

## 边界

- <code>--max-concurrency</code> 与 Experiment <code>maxConcurrency</code> 都只约束本 Invocation。
- Sandbox handle 与复用池不跨 Invocation。
- 同一 root 的 reader、writer 和受控编辑互斥；静态 export 只在 Record 读取/build 阶段持有 operation lock。
- 要比较两个独立 Record，先把需要的 Run 写进一个停稳 Record；Reports 不提供跨 Record Sample。

## 相关阅读

- [并发 Invocation 架构](../../architecture.md#并发-invocation)
- [缓存与 Attempt 采用](../../cache.md#并发-invocation)
- [限制全局并发](限制全局并发.md)
