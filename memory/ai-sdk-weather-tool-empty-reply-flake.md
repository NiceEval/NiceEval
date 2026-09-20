---
format: concord.document/v1
id: ai-sdk-weather-tool-empty-reply-flake
title: ai-sdk-weather-tool-empty-reply-flake
createdAt: 2026-07-01T19:41:04+08:00
createdAtSource:
  kind: first-recorded
  path: memory/ai-sdk-weather-tool-empty-reply-flake.md
  commit: dd61d6015b3f040e7182a9001af81e7e74b95135
description: examples/zh/ai-sdk weather-tool eval 某次跑批 gpt-5.4 全部断言失败，根因是上游模型请求瞬时退化返回空文本，不是 tool 没传也不是 niceeval 采集问题
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---

**现象**：`.niceeval/2026-07-01T11-30-22-990Z/summary.json` 里 `compare-models/gpt-5.4` 实验组跑 `weather-tool` eval，两次 attempt 全部失败：a0 连 `calledTool(get_weather)` 都没通过，a1 工具确实被调用且拿到正确数据，但两次最终 `reply` 都是兜底文案「我已经处理了这一步」，且两次 `usage` 都是 `inputTokens:0 outputTokens:0 requests:0`。trace.json 显示 a0 那次 `chat gpt-5.4` span 只花了 848ms（明显短于正常生成耗时，其余同批次用 gpt-5.4 的 eval 都在 4~11s）。

**根因**：不是 `examples/zh/ai-sdk/src/ai-sdk-runtime.ts` 没把 tools 传给 `generateText`（`buildTools` 正常传入，同一批次里 `image-understanding`/`multi-turn`/`multi-turn-image` 用同一个 gpt-5.4 都正常调用工具并通过），也不是 niceeval adapter/事件采集出错（`adapter/adapter.ts` 如实把当时真实发生的空响应映射成了事件）。真正原因是那次对 `gpt-5.4`（走 `.env` 里 `OPENAI_BASE_URL=https://s2a.jihuayu.site/v1` 这个第三方代理）的某次真实请求本身退化返回了空内容/无 usage——大概率是代理在并发压测（`niceeval.config.ts` `maxConcurrency:4` + 两个实验组几乎同时起流量）下的瞬时抖动，而不是稳定可复现的 bug：事后单独 curl `/api/turn`（同一份代码、同一个 gpt-5.4）连续多次全部成功。

**修法**：排查这类"eval 突然全灭"先看 `.niceeval/<run>/<eval>/<agent>/<model>/aN/trace.json` 里 model span 的耗时和 `usage` 是否为 0——耗时异常短 + usage 全 0，基本可判定是上游 provider/代理这次没有真正产出内容，而不是被测程序逻辑错了；同时看同批次其它用同一个 model 的 eval 有没有正常通过来排除"这个 model 完全不支持工具"的可能。

顺手发现一个值得修的地方（未修）：`ai-sdk-runtime.ts:133` `const reply = result.text.trim() || "我已经处理了这一步"` 会把"模型这次真的没产出任何内容"悄悄伪装成一句正常话术，让排查时误以为是模型主动选择不答/不调工具，掩盖了真正的空响应信号。更好的做法是文本为空时按失败处理（或至少打个 warning 日志/标记事件），而不是静默填充兜底文案。
