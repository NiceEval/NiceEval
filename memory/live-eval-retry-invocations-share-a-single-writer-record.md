---
format: concord.document/v1
id: live-eval-retry-invocations-share-a-single-writer-record
title: Live Eval 补跑 Invocation 共享单写者 Record
createdAt: 2026-08-13T16:19:40+08:00
createdAtSource:
  kind: first-recorded
  path: memory/live-eval-retry-invocations-share-a-single-writer-record.md
  commit: 8b111232d392814031227503a87dec451c0afcf8
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [live-eval-retry-invocations-share-a-single-writer-record](live-eval-retry-invocations-share-a-single-writer-record.md) — 同一 Repo 的多个 Eval 补跑 Invocation 用并行 CLI 写同一个 Record 会确定性触发 RecordWriterBusy；仅补跑串行，主 Invocation/Repo batch 并发不变"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# Live Eval 补跑 Invocation 共享单写者 Record

## 现象

2026-08-13，PR #47 Docker batch（run `31679732962`）中，Codex live E2E 首轮产生两个
可补跑的 `verdict: failed`。测试用 `Promise.all` 同时启动两条精确的
`niceeval exp <experiment> <eval> --rerun all --json`，其中一条不到一秒就以
`RecordWriterBusy` 退出且没有 receipt，后续 `expReceipt()` 因空 stdout 再报错。

## 根因与修法

Repo batch 之间可以并行，单个 `niceeval exp` 内部的 Attempt 也可以并行；但同一 Repo 的
多条补跑 Invocation 继续写同一个 `.niceeval/record`。Record 的并发契约是单写者，多个
独立 CLI writer 进程不能重叠。这里把 I/O 密集误解成所有层次都能继续超开，反而制造了
确定性的 writer 冲突。

修法只把罕见的失败补跑 Invocation 按首轮事件顺序串行；主 Invocation 内部并发、不同 Repo
batch 并发和所有首轮运行均保持不变。不要通过忽略 `RecordWriterBusy`、另建未纳入 locator
链的临时 Record，或并行后重试 writer 冲突来伪造绿色。

同一规则也适用于 Claude Code 等其它 live Adapter owner：只有 `verdict: failed` 表示模型输出
没有达到断言，允许精确补跑一次；`errored`、`skipped`、超时、setup 或 I/O 故障必须保留为
失败。否则补跑会同时掩盖基础设施根因，并可能因共享 Record 的并发 writer 再制造二次故障。
