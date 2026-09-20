---
format: concord.document/v1
id: codex-sdk-web-search-s2a-flaky
title: codex-sdk-web-search-s2a-flaky
createdAt: 2026-07-03T13:18:10+08:00
createdAtSource:
  kind: first-recorded
  path: memory/codex-sdk-web-search-s2a-flaky.md
  commit: bd0e3e6aae8a54546a57ff973538f08e49bc4a7c
description: codex-sdk demo 走 s2a 代理时内置 web_search 极不稳定——单个问题连发 9+ 次检索重试,有时整轮失败;SDK 的 WebSearchItem 只有 query 字段,UI 层无法区分成败
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---

**现象**：`examples/zh/origin/codex-sdk` demo 问"北京天气"，Codex 连发 9 次以上 `web_search`（不断换 query 措辞重试），耗时 60s+；有时最终放弃并回复"工具没成功返回"（用户截图里的失败），有时最后一次靠直接搜 URL 拿到结果。

**根因**：demo 走 `CODEX_BASE_URL`（s2a 的 OpenAI 兼容 Responses API 代理），`web_search` 是 Responses API 的服务端工具，代理对它的支持不稳定，检索结果经常为空/无效，模型于是反复改写 query 重试。这不是 demo 代码的 bug。另外 SDK 的 `WebSearchItem` 类型只有 `query` 一个业务字段（没有 status/results），ui-stream 层拿不到成败信号，所以 UI 上只能看到一串 web_search 气泡、无法标红失败。

**修法**：demo 层面无法根治（代理端限制）。可选缓解：`ThreadOptions.webSearchMode: "disabled" | "cached" | "live"`（SDK 0.142.5 起，映射 CLI `--config web_search=...`）——把它设成 `"disabled"` 可以让模型直接说"无法联网"而不是重试风暴，但也就演示不了联网检索了，当前 demo 保持默认开启。要稳定演示"查天气"这类问题，用自带 get_weather 工具的 claude-agent-sdk / pi-sdk demo，codex demo 的定位是 workspace/ 里的编码任务。
