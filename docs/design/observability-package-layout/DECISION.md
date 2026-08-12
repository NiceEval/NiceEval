# Decision

尚未裁决。当前产品契约继续采用 [PLAN-1](PLAN-1/README.md)。在本文件明确采纳另一候选并同步
Record Feature 前，[PLAN-2](PLAN-2/README.md) 只是设计候选。

裁决只选择 Observability 的 durable inventory 与 layout state。通用 `PackageReadResult<Value, LayoutState>`
属于 Projection；本决策不能把 PLAN-2 state 固定进其它 package 的读取结果。
