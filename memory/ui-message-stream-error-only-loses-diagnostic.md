---
format: niceeval.memory/v1
id: ui-message-stream-error-only-loses-diagnostic
title: UI Message Stream 只有 error 帧时丢失原始诊断
createdAt: 2026-09-05
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_KVVCE7VKN9EFYDD4
      - nered_7QJHGC208AJ1SJS2
      - netake_VHK27B6CM7EKD33P
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/adapter/local-protocol/test/disconnect.test.ts#necase_2Q053XPZ22MT68HW"]}
promotions: []
---
## 观察与根因

PR #222 的 AI SDK live CI 只显示没有 assistant 消息的泛化错误；同批部分 provider 明确返回 503，但不能据此断言这个 stream 也返回了 503。

`uiMessageStreamAgent` 已收集合法 error 帧的 `errorText`，却在 `[DONE]` 之后没有 assistant message 时先返回泛化错误，丢失端点提供的原始失败信息。确定性 local-protocol fixture 用 error-only + `[DONE]` 从安装后的 CLI 与 `attempt.trace` 验证这一诊断缺口，不依赖付费 provider。

## 修正与验收

沿现有 malformed-stream owner 保持 `agent-send-failed`、`execution-error`、`eval.run` 与 unknown acceptance；没有 assistant 时优先保留 errorText，仍然失败且不生成虚假的 assistant 或 Turn。没有 error 帧的 fallback 使用英语。公开红灯、候选转绿与完整 takeover 后才标记 fixed。

Owner：`e2e/adapter/local-protocol/test/disconnect.test.ts#necase_2Q053XPZ22MT68HW`。

Astra 对首次修复的只读挑战发现：合法的空串或纯空白 errorText 被直接交给 makeSendFailure 时，会触发其非空 message 校验并抛 TypeError。最终修正只对非空白文本原样保留；空白输入使用非空英语 fallback。同一公开 owner 同时覆盖非空、空串和纯空白；首次仅非空场景的 fixed 状态与回归关系已撤回，必须重新取得当前源码证据。
<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `cf8fbb1ad0962c8bfa56b29d89aea8e5b3af3f7f`

```json
{
  "kind": "fixed",
  "proof": [
    "nered_FRGYTDMXG7FSK7JW",
    "netake_BK4YE34S1190V4X1",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/adapter/local-protocol/test/disconnect.test.ts#necase_2Q053XPZ22MT68HW\"]}"
  ]
}
```
