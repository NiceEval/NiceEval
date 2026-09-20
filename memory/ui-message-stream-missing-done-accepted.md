---
format: concord.document/v1
id: ui-message-stream-missing-done-accepted
title: UI Message Stream 缺少 `[DONE]` 曾被接受
createdAt: 2026-08-20T00:34:27+08:00
createdAtSource:
  kind: first-recorded
  path: memory/ui-message-stream-missing-done-accepted.md
  commit: 7868d833984f568cb7cb7f0a155702a32540c8f2
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
    statement: "- 已修 [ui-message-stream-missing-done-accepted](ui-message-stream-missing-done-accepted.md) — UI Message Stream 在部分 assistant 帧后断开且没有 `[DONE]` 时曾被当成成功 Turn；修为把结束标记纳入协议完整性，提前 EOF 公开为 `agent-send-failed`"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# UI Message Stream 缺少 `[DONE]` 曾被接受

## 症状

本地 endpoint 先发送合法的 assistant SSE 帧，再直接关闭连接而不发送 `data: [DONE]`。`uiMessageStreamAgent` 仍把已经归约出的部分消息当成成功 Turn，直到 Eval 的后续 sentinel 抛出 `unexpected-error`。另一种畸形响应先发送 `[DONE]`、再发送完整 assistant 帧时，late frames 也会被归约成成功 Turn。

## 根因

SSE parser 会识别并丢弃 `[DONE]`，但没有把“见过协议结束标记”保存为 reducer 状态，也没有把它当成真正的协议终点。EOF 与完整结束对 Adapter 来说完全相同，结束标记后的帧仍会进入 reducer。

## 修复

parser 在读到 `[DONE]` 时记录完成事实并终止 reducer 输入。Reducer 结束后仍未见该标记，就返回 `agent-send-failed`，并在公开 `show @<attempt> --json` 诊断中说明响应提前结束；结束标记后的帧不能补成成功 Turn。

长期回归由 `e2e/adapter/local-protocol/test/disconnect.test.ts` 拥有。它从安装候选分别运行缺少结束标记和结束后补帧的真实 `niceeval exp`，确认 fixture 命中目标路由，再从公开 `show` 读回错误分类和摘要。
