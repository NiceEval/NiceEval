---
format: niceeval.memory/v1
id: codex-thread-diagnostics-confused-with-terminal-failure
title: Codex SDK 非致命告警被误判为 Turn 失败
createdAt: 2026-09-05
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - Installed old-candidate public red nered_K4ACT1Y87VBTQE3D; fixed candidate bce0e61263bef5a1415b46fffa282cee04810c6d09ed7586fbea91361d8423e4 passed netake_N0SWY5MB45QGDPCN including all seven observations and cleanup.
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/adapter/sdk-converters/test/codex-thread-stream.test.ts#necase_C2K9MBSGV9A6TC0A"]}
promotions: []
---
## 公开现象

2026-09-05 的 Codex SDK live E2E 中，公开 attempt.trace 显示模型发出缺少模型元数据的非致命告警后，真实 shell 命令仍成功完成，但 NiceEval 把 Turn 标为 failed。CI 33968503589 的 host-2 失败；本地安装同一 041f23aa 候选的公开入口重现。

## 根因

createCodexThreadEventStream 把 SDK ErrorItem 当作终态失败，且遗漏顶层不可恢复 error。官方 SDK 的 ErrorItem 为非致命诊断；是否执行失败不能按告警文本白名单判断。

## 修正与验收

非致命 item 保留原始标准 error 事件但不设置 failed；turn.failed 与顶层 error 设置 sticky failed，空消息也不例外。SDK iterator/进程异常继续抛出 SendFailure。既有确定性 converter Journey 同时核验成功结果、公开诊断、工具配对、usage 和真实终态错误；顶层 fatal 在安装后公开 Library 入口核验，不伪造 Turn。旧候选 formal red 为 nered_K4ACT1Y87VBTQE3D；固定候选 bce0e612 的 netake_N0SWY5MB45QGDPCN 已通过全部 7 项观测，包含默认并行与资源终结。

## Authority

- [官方 SDK ErrorItem](https://raw.githubusercontent.com/openai/codex/rust-v0.142.5/sdk/typescript/src/items.ts)
- [官方 SDK ThreadEvent](https://raw.githubusercontent.com/openai/codex/rust-v0.142.5/sdk/typescript/src/events.ts)
- [Adapter 库用法](../docs/feature/adapters/library.md#sdk-与协议转换器)
