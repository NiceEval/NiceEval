# 结果携带与 Sandbox 复用反馈 —— Architecture

## 单一决定链

```text
frozen Record view + ExecutionTarget + policy
                    │
                    ▼
           project-target/v1 planner
                    │
                    ▼
          frozen ExecutionReusePlan.slots
           ├─ CLI dry / live projection
           ├─ scheduler 的 execute view
           └─ writer provenance + outcome
```

planner 是唯一读取历史 Candidate、选择 source barrier、比较资格并生成完整 prior locator 的组件。
`ExecutionReusePlan.slots` 按 target 顺序穷尽一次。
任何 Slot 只有一个 action，且 action、locator 和 explanation 在同一次规划中绑定。

scheduler 只收到 `execute` view。
它不能打开 Record、重算 identity、改变 `carried`，或为无 outcome 的 Slot 制造 Member。
writer 只验证 target、引用和 outcome 与 plan slot 的连接关系。

## owner 与持久边界

Record Core 拥有 Run、Slot、Member、Attempt 和精确 reference。
Attempt 仍拥有 Verdict、Usage、证据与 Sandbox 调度事实。
`niceeval.membership-provenance/v2` 只保存“当时的 plan 决定为何如此”和 outcome。

frozen plan 是 Invocation 内存值，不是 RecordAttachment。
它不会成为未来 reuse 的捷径，也不会由 Report 直接读取。
未来 planner 只使用新的 frozen view、公开 policy 与 source Attempt 事实。

`sandbox.reused` 是 Attempt-owned 调度事实。
`SandboxReuseSummary` 是 Invocation 进度值。
二者都不改变 `carried`、Member relation 或 Attempt origin。

## 失败与局部性

| 边界 | 结果 |
|---|---|
| 一个 source Member、Attachment 或 locator 无效 | 对应 Slot 生成 `execute` 与真实 issue。 |
| source Run 的 membership 或排序事实无效 | 对应 Experiment 的 Slot 生成 `execute`。 |
| Experiment 归属无法安全读取 | 全部 target Slot 生成 `execute`。 |
| Record 无法打开、target 不完整或 policy 不受支持 | 不形成 plan，不建立 Invocation。 |
| 已计划 execute 的 Slot 未派发 | provenance 写 `not-dispatched` 或 `interrupted`，不写 Member。 |

任何局部历史问题都保留原始 `RecordIssue` 与 gap reason。
它不能被改写成“没有历史结果”，也不能触发对更旧 Run 的回扫。

## 并发与生命周期

writer lock 保护正式 Invocation 的 target 建立、frozen planning、执行和 seal。
因此当前 Invocation 不能把自己尚未发布的 Run 当 source barrier。
另一条 writer 不能领取一部分 gap 或合并 plan。

dry 使用 shared maintenance lease，只读取已完成 Run。
show 与 view 同样只消费已发布的 Run。
Sandbox 实例、复用池和 `SandboxReuseSummary` 都不跨 Invocation。

## 删除与迁移

删除 planner 外部的 reuse explanation builder、短 prior ID formatter、`reused` 输出与独立 plan slice。
删除只影响结果携带反馈，不改变 `sandbox.reused` 的持久含义。

membership provenance 由 v1 迁到 v2。
迁移只读同一 provenance payload 和它已有的 Core reference。
缺失的解释或 locator 不能由当前 source Attempt 反推；该 payload 必须报告 migration-unavailable。

## 生产入口验收

生产验收包含一个 carried Slot、一个有 prior 的 execute Slot、一个没有 prior 的 execute Slot，以及一个未派发 Slot。
同一切片经过 `exp --dry`、`exp`、`show` 与 `view`。
验收同时验证 writer 互斥、sealed provenance 和 Sandbox 汇总。
不新增 Eval Assertion；CLI-only 行为由真实 CLI/E2E 旅程证明。
