# Decision

## 裁决

旧统一 Runtime 方案曾采纳
[PLAN-2](PLAN-2/README.md)：一个 canonical Record root 由同一个 `RecordAccessRuntime` 管理，并向 host mint
snapshot、invocation 与 maintenance facets。

这是被独立 Record Host 与 Coordination SDK 取代的历史选型裁决，不构成当前公共 API。

## 为什么选择 PLAN-2

- read、Invocation write 与 maintenance 共享 canonical root identity、runtime registry 与 validators；
- snapshot generations 与 exact-content verified cache 只有一个 owner；
- nominal facets 让 Report host、Invocation coordination 与 maintenance CLI 只拿最小 authority；
- outer runtime 不长期持有 lease，空闲时不会阻止 migration；
- write session 关闭后再开 fresh snapshot，明确区分 reuse planning view 与 Analysis view。

## 为什么否决 PLAN-1

[PLAN-1](PLAN-1/README.md) 可以让每次 reader / writer open 各自正确，但不能保证同一 host operation 内共享 root
authority、generation allocator 或 verified material。调用者若自行拼接多个 open，就会重新承担 cache identity、
锁顺序与 fresh snapshot 的协调责任。

## 当前契约落点

- Record Host、惰性读取与写会话：[Record Library](../../feature/run/library.md)。
- lease 与并行调度边界：[三层总览](../../feature/run-inspection/README.md)。
- durable layout 与提交点：[Record Architecture](../../feature/run/architecture.md)。
