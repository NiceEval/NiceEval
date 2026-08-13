# Decision

## 裁决

为 [Capture → Analysis → Report Roadmap](../../roadmap/record-analysis-report/README.md) 采纳
[PLAN-2](PLAN-2/README.md)：一个 canonical Record root 由同一个 `RecordAccessRuntime` 管理，并向 host mint
snapshot、invocation 与 maintenance facets。

这是 Roadmap 目标的选型裁决。该方向被产品采用前，[Record Feature](../../feature/record/README.md) 仍是唯一当前
契约；Design Decision 不自行替换 Feature。

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

## 契约落点

- 三种 facets、锁与 cache：[Roadmap Library](../../roadmap/record-analysis-report/library.md)。
- Invocation→Report 时序：[Roadmap Lifecycle](../../roadmap/record-analysis-report/lifecycle.md)。
- 领域事实写入边界：[Capture → Analysis → Report](../../roadmap/record-analysis-report/architecture.md)。
