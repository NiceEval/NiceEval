# Record access runtime

本决策比较同一 host operation 怎样拥有 Record root 的本地运行资源。Record facts、Core、Attachment、
`FrozenRecordView` 与写入语义保持不变；候选只改变 root identity、snapshot generation、locks 和 verified
read cache 的资源 owner。

现有契约已经统一“读什么”：`RecordReader` 与 `RecordWriteSession.view` 都是完整
`FrozenRecordView`。本决策只比较不同 open 是否共享同一个 root-affine runtime guarantee。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1：各 open 独立拥有资源](PLAN-1/README.md)
- [PLAN-2（推荐）：统一 RecordAccessRuntime substrate](PLAN-2/README.md)
- [Decision](DECISION.md)
