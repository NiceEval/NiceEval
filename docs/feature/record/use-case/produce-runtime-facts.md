# 产生并提交运行事实

本用例面向 Runner 或第三方 producer。目标是在同一个 `RecordWriteSession` 中读取既有历史、执行 gaps，并把每个完整 Run 原子发布；运行中状态只进 local session 和当前进程反馈。

## 1. 昂贵工作前建立写边界

用 `Effect.scoped` 打开 `openRecordWriteSession({ root, mode: "open-or-create" })`。入口依次完成：

1. 求得 canonical physical root，映射并验证 local sidecar；
2. 取得 OS writer lock；
3. 检查所有遗留 sessions；存在任一项就返回 `record-recovery-required`；
4. preflight lock、no-follow、file/dir fsync、同 filesystem 与 no-replace directory rename；
5. 创建绑定 `canonicalRoot + recordId + sessionId` 的 local session；
6. 冻结 `session.view` 的 candidateSet。

以上任一步失败都不能启动模型、Sandbox、外部命令或付费调用。reader 仍可在 writer session 期间并发。

## 2. 形成 target 与 projection

Invocation builder 在内存中为每个目标 Run、slot 与将要执行的 Attempt 分配 opaque identity，绑定 `startedAt` 和完整 expected slots。它把当前 ProjectTarget、尚未发布的 ExecutionTarget 与 `session.view` 交给 execution projector。

projector 只从 frozen candidateSet 选择 source，并沿已选 Member 建 dependency closure。每个 slot 穷尽形成 `reuse | gap`。本 session 后来发布的 Run 永远不会反过来参与这次 projection。

eligibility 是 required fact。projector 只有在 schema 可解码、`reuseContract` domain 被当前 policy 接受且 equality token 完全相等时，才继续比较 input、config、duration 与其它 gates。任一 unsupported、missing 或 mismatch 都形成 gap。

## 3. 在 local build 中收集事实

producer 把所有未提交内容写入 `sessions/<sessionId>/build/runs/`。业务变化只通过 generic channel payload 进入，不扩张 write-session API。

| 数据 | owner 与形态 |
|---|---|
| terminal Verdict 与 eligibility | Attempt-owned exact JSON document |
| Assertions、usage、timing、commands、diff | 对应 built-in Attempt schema |
| conversation 与 diagnostics | Attempt/Run-owned NDJSON schema |
| 大文本或二进制 | owner-local blob，由具名 channel 引用 |
| Eval source snapshot | origin Run-owned `niceeval.sources/v1` manifest 与 Run-local digest blob |
| carry、accept、rename 与 gap 理由 | target Run-owned `niceeval.actions/v1` |

实际执行产生的 Attempt 住在当前 origin Run 的 `attempts/<attemptId>/`，并由同 Run 的 `executed` Member 唯一反向锚定。carried/accepted Member 只保存 `{ originRunId, attemptId }`；它们不复制 Attempt，也不改变 origin。

当前进度、心跳、尚未完成的 event 和 Sandbox handle 不进入 durable Record。崩溃后的 building-only session不能继续外部执行，只能 explicit abandon。

## 4. 一次 seal 整个 Run

Run 完成或 Invocation 中断后，producer先形成最终 `completedAt`、expected membership、已有 Member 与业务通道。没有 outcome 的 expected slot 保持无 Member，并由 actions/diagnostics 解释。

`stageRun(completeRun)` 必须：

1. 穷尽验证 core、identity、origin、descriptor、schema、coverage、payload 与 blob；
2. 验证每个嵌套 Attempt 有且仅有一个 executed 反向锚；
3. 验证 carried/accepted 引用属于 frozen dependency closure；
4. `fsync` 并 close 每个普通文件，把完整目录移入 `publish/<runId>` 后从此禁止修改；
5. 由深到浅 `fsync` source 的每个 directory，再重新读取 source 并计算穷尽 entries 的 SHA-256 recovery manifest；
6. atomic write、`fsync` manifest file，并 `fsync` recovery parent。

第 6 步完成后才返回 opaque `SealedRun`。它仅可由创建它的 session 发布一次。

## 5. Publish 与 crash recovery

`publishRun(sealed)` 重新校验 source 与 destination，然后执行 no-replace atomic directory rename。成功后必须 fsync source parent 与 `R/runs/`，再从 destination 重新计算 manifest。只有完全匹配后才允许清 local staging/recovery。

一次 Invocation 的多个 Run 逐个发布，没有 Invocation 级事务。任何时点 reader 只会看见完整 Run。rename 前崩溃留下 source；rename 后、marker 前崩溃留下 destination；两者都由 [五态 crash matrix](../architecture.md#recovery-manifest-与-crash-matrix) 唯一判定。

正常 Scope finalizer 可以删除本 owner 尚未 seal 的 build temp，但不能删除 sealed 或 cleanup-pending 现场。下一次写入先要求用户运行：

```text
niceeval record recover --session <sessionId> --commit-only
# 或明确放弃 local 现场
niceeval record abandon --session <sessionId>
```

commit-only recovery 不再次调用 producer、projector、模型或 Sandbox。unknown future session schema 也不能自动 clean；只允许具名 abandon。

## 6. 返回 receipt，再从 reader 查看

全部可提交 Run 处理后，Runner 返回窄 `InvocationReceipt`：Invocation identity、Run identities、起止时间与 completion。receipt 不复制 Verdict、用量、费用、locator 或计数。

Scope 释放 writer lock 后，`show`、`view` 或静态 export 重新打开 lock-free reader。它们也可以在 writer 尚未结束时看到已经发布的完整 Run，但 weak scan 不保证看到本 Invocation 的全部 Run。

## 反例

| 错误做法 | 违反的边界 |
|---|---|
| 在正式 Run 目录逐文件追加 | reader 会看见半成品，破坏 Run 提交单位 |
| 把 session/lock/cache 写进 `record/` | local 状态进入 portable/Git 边界 |
| publish 后补 `completedAt` 或 channel | 已发布 Run 不再 immutable |
| 给新业务增加 `RecordWriter.writeX2()` | storage API 再次跟着业务 schema 代际扩张 |
| 只升级 policy identity 来表达新 carry gate | 旧 projector 可能忽略新事实并错误 carried |
| crash 后凭 marker 猜 rename 是否成功 | marker 不能在 staging 被移动后证明 destination bytes |
