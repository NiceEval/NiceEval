---
format: niceeval.memory/v1
id: trace-mutation-validates-dependencies-before-exclusive-lease
title: Trace 多文件发布前置条件在 exclusive lease 外验证
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# Trace 多文件发布前置条件在 exclusive lease 外验证

P1；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Sol review，父 agent 独立复核。入口：`packages/repo-tools/src/docs/trace/relation-mutation.ts:1032`。

Case relation 的 Memory、owner、inventory 或 evidence 前置条件通过后、取得 exclusive lease 前，另一协作者可改变这些依赖；输出文件未变时，陈旧前置条件仍可能被发布。目标是完整 Snapshot 与 preimage 共同保护 publication，见 [Trace 一致性](../docs/engineering/docs-traceability/README.md)。

`docs/test-case/cli-runtime.ts` 在 publish 之前调用 validateOpenProblem、validateOwner 或 evidence 校验。publish 仅把输出 changes 与 expectedDigest 传给 mutateTraceFiles。后者取得 lease 后只核对待写文件、当前 HEAD/index 与输出 preimage，没有接收前置 Snapshot、依赖 preimage 或 under-lease preparation。

待验证：在验证与 lease acquisition 之间设置可控 barrier，用另一个正式命令改变 Problem 状态或 owner contract；publication 应零写入失败。修复需在同一 lease 下绑定完整依赖，不能只扩大输出文件集合来伪装锁保护。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。

## 2026-09-05 修复验收

父 agent 使用实际 docs test owner set 命令与系统 flock barrier 对比旧实现和修复候选：在 exclusive lease 前改变目标 Feature，旧实现写入过期计划，修复返回 stale digest 且 owner 零写入。发布前重新验证 owner、目标 preimage 与当前 Trace，所有变更继续通过同一 journal/CAS。

实现与上述仓库入口验收已完成；当前结构化 fixed 门只接受产品 E2E 凭据，尚无仓库 DX 凭据类型，因此保留 open，不借用无关产品 case 宣称 resolved(fixed)。
