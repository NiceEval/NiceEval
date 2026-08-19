# UI Message Stream 缺少 `[DONE]` 曾被接受

## 症状

本地 endpoint 先发送合法的 assistant SSE 帧，再直接关闭连接而不发送 `data: [DONE]`。`uiMessageStreamAgent` 仍把已经归约出的部分消息当成成功 Turn，直到 Eval 的后续 sentinel 抛出 `unexpected-error`。公开诊断因此没有指出 transport 响应被截断。

## 根因

SSE parser 会识别并丢弃 `[DONE]`，但没有把“见过协议结束标记”保存为 reducer 状态。EOF 与完整结束对 Adapter 来说完全相同。

## 修复

parser 在读到 `[DONE]` 时记录完成事实。Reducer 结束后仍未见该标记，就返回 `agent-send-failed`，并在公开 `show @<attempt> --json` 诊断中说明响应提前结束。

长期回归由 `e2e/adapter/local-protocol/test/disconnect.test.ts` 拥有。它从安装候选运行真实 `niceeval exp`，确认 fixture 命中断流路由，再从公开 `show` 读回错误分类和摘要。
