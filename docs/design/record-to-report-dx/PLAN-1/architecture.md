# Report Query Architecture

Report host 从 consumer-local query declarations 编译一次封闭执行。Record 保持事实层；query
只决定怎样读取、对齐和纯派生这些事实。

## 唯一执行顺序

```text
validate Report ID / keys / routes / query graph
                ↓
collect Page / PageFamily / Download data
                ↓
close the unique ReportQuery DAG before Record I/O
                ↓
form exhaustive logical rows and read Attachments
                ↓
evaluate and cache each query identity once
                ↓
execute Pages independently
                ↓
expand each Family, then execute each instance independently
                ↓
execute Downloads independently
                ↓
freeze immutable ReportExecution
```

Query graph immutable、bounded 且可检测 cycle。Invalid report ID、object key、route、query cycle
与 definition shape 在任何 Record I/O 前汇总为 definition error。

宿主可以按 frozen snapshot、exact owner 与 family 缓存物理 Attachment read。它不能结构性去重
query callback，也不能合并 logical rows。Query defect 只产生一个 execution problem；所有依赖
consumer 引用同一个 problem ID，无关 consumer 继续执行。

真实 filesystem、permission、closed reader 或错误 capability 仍是整个 execution 的 typed Effect
failure。Attachment 的六态是成功数据。project callback throw 是 query execution problem，不变成
Attachment invalid 或第七种状态。

## Consumer 隔离

Page、PageFamily 与 Download 分别是执行边界。Family 的 `instances` 是 family 边界，每个
`render` 又是 instance 边界：

- 一个 Page defect 不作废其它 Page；
- `instances` defect 只作废该 Family；
- 一个 instance render defect 不作废相邻 instance；
- 零 instance 仍保留 family result 与 problems；
- query failure 只阻止依赖它的 consumers；
- static export 对 execution problem 保持 fail closed。

Family 不允许 per-instance query。它的全部 I/O 依赖必须由 family-level `data` 在展开前闭合。
logical-slot page 与 physical-Attempt page 使用不同 identity constructor；相同 Attempt 被多个 slots 引用时
不自动合并页面。

Built-in consumer 不构成新的权限层。官方 Attempt Page 与用户 PageFamily 经过同一个 definition
validation、query closure、Attachment read、derive 与 instance isolation。Host 不能因 consumer 来自
package 内部就提供额外 reader、locator lookup 或 legacy evidence bridge。这个约束保证官方组件也能
作为公共作者 API 的真实 dogfood，而不是第二套取数实现。

所有 query、derive、page、family、instance 与 download callback 同步且最多执行一次。组件只接
plain values。任一 `ReportExecution` 在返回前已经固定 documents、routes、downloads 与 problems；
terminal、web 与 static 不重新运行作者代码。

## Selection 边界

Selection 在 Report 外产生固定的 selected Runs 与 logical slot universe。Report query 不选择 Run，
也没有 `where`。`attemptSlots()` 的 logical identity 固定为 `(selectedRunId, slotId)`。

Reference Member 同时关联 selected Run 和 Attempt 的 origin Run，因此 Run-owned field 必须显式
选择 relation。selected Run Evaluation 决定 logical slot 的题型与 denominator；origin Run
Evaluation 只校验 reference compatibility。

## Record 充分性审计

先从不迁就现有 Sample、Projection 与 Report API 的自然作者语法出发，再检查它能否只依赖当前
Record 公理实现：

| 用例 | 现有 Record 表达 | 判断 |
|---|---|---|
| 多个 slots 引用同一 Attempt | 每个 Run Member 保存 `slotId + RecordAttemptRef` | 通过；logical rows 不随物理引用去重 |
| 区分 selected Run 与 origin Run | Member 指向 Attempt，Attempt 保存 `originRunId` | 通过；查询层必须显式 relation |
| Assertions、Verdict、Score 与 Evaluation | owner-local typed Attachment | 通过；不进入 Core |
| Attachment schema 演进 | family + adjacent migration + 六态读取 | 通过；query 原样保留数据状态 |
| Assertion/turn 详情页 | Attachment payload 内 durable entry identity | 通过；PageFamily 纯展开 |
| 多次 historical grading | 新 grading Run + reference Members + Run-owned claims | 通过，但 producer contract 必须验证 subject closure |
| 大 trace/diff 只读一个 chunk | `available` 前把全部 blob bytes 读入内存 | 不通过选择性读取；属于 reader capability 限制 |

因此 portable Record format、Core、run/attempt owner、identity、exact reference 与 publication model
足以支撑新的顶层查询语法，不需要因为 Report DX 修改磁盘格式。

## Grading claim 压力测试

后续 grading 不修改 origin Attempt。每次 grading 是一个新的 immutable Run：

```text
grading Run Core Member(slotId)
        │ exact RecordAttemptRef
        ▼
origin execution Attempt

grading Run-owned claim Attachment
  claimId + slotId
  subjectNodeId + subjectSemanticDigest
  grading definition / evaluator identity
  AssertionResult + Verdict or Score
```

Core Member 是权威 Attempt subject edge。Claim payload 中重复的 Attempt ref 只能交叉校验，不能另造
一条引用。Producer 在 publish 前验证：

- 每个 claim slot 恰有一个 Member；
- Member 指向 frozen history 中的 exact Attempt；
- `subjectNodeId` 存在于该 Attempt 的 sealed Observation；
- semantic digest、definition identity、claim identity 与 evaluation kind 完整。

Grading-aware reader 再次验证这些关系。多个 grading Runs 可以并存，调用者显式选择，永远不猜
latest。Observation migration 必须保留 subject node identity 与 semantic digest；做不到时声明
migration-unavailable。

这证明当前 Run + Member + Run-owned Attachment 能承载多次 grading，不需要新增 Core owner 或把
新 claim 写回 Attempt-owned Verdict。

## Record reader 的高等级限制

当前 `RecordAttachmentValue` 在 `available` 前读取、验证整份 blob closure，并把全部 bytes 读入内存。`bytes(ref)`
还返回 defensive copy。因此单份 Attachment 的峰值 I/O 与内存随完整 closure 增长，而不是随 query
实际读取的字段或 blob 增长。物理缓存只能减少重复读取，不能降低这次峰值。

Assertions、Verdict、Score 与 Evaluation 等有界 JSON 不受阻。大型 Conversation、Trace、Diff、
多媒体或分块 artifact 不能宣称支持选择性详情读取；PageFamily 也不能用 per-instance query 绕过。

这是 Record Library reader capability 的高等级、架构级范围限制，不是 portable format correctness
defect。本候选不修改 Record 持久契约；未来可以另行设计 selective/indexed blob snapshot 或新的
reader capability。

## 下一项 falsifier

最可能推翻当前 Record 的反例是跨 Attachment、跨 owner 的 subject identity migration：

1. grading claim 指向 origin Attempt 的 Observation v1 node；
2. Observation v2 把该 node 拆成多个新节点，无法永久保留旧 identity 或 alias；
3. claim 位于另一个 Run-owned Attachment；
4. owner-local converter 无法读取 origin Observation 并协同改写其它 Runs 的 claims。

如果 `migration-unavailable` 不能满足产品需求，现有 owner-local migration 就无法维持 referential
integrity。届时应重新评估 first-class subject reference 或 coordinated cross-Attachment migration；
不能靠 Report query 掩盖。
