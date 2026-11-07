# coding-agent-skill 的 judge 模型在代理端点上 503

## 现象

在 `examples/zh/coding-agent-skill` 跑任何实验（如 `niceeval exp ponytail ponytail-csv-sum`）时，judge precheck 直接失败：

```
judge precheck failed (claude-haiku-4-5-20251001): judge HTTP 503:
{"error":{"message":"Service temporarily unavailable","type":"api_error"}}
```

看起来像瞬时故障，重试仍然 503。

## 根因

judge 走 OpenAI-compatible 端点（`OPENAI_BASE_URL`，见 `src/scoring/judge.ts` 的 resolveJudge 链）。本机可用的代理（`examples/zh/eval/claude-agent-sdk/.env` 里的 `OPENAI_BASE_URL`）只服务部分模型：`gpt-5.4` 返回 200，`claude-haiku-4-5-20251001` 恒 503。而 `examples/zh/coding-agent-skill/niceeval.config.ts` 把 judge 模型写死成 `claude-haiku-4-5-20251001`，且 config 里的 `judge.model` 优先级高于 `NICEEVAL_JUDGE_MODEL` env，无法用环境变量覆盖。

「503 Service temporarily unavailable」实际含义是「这个代理不支持该模型」，不是瞬时故障——重试没用。

## 修法

- 快速判断：用 curl 直接 probe `$OPENAI_BASE_URL/chat/completions`，换不同 model 名对比状态码；503 恒定即模型不被代理支持。
- 跑通实验：临时把该示例 `niceeval.config.ts` 的 `judge.model` 改成代理支持的模型（如 `gpt-5.4`），跑完按需还原。
- 适用场景：任何 example 的 config 里 judge 模型写死、而本地只有代理 key 时，都可能遇到同样问题。
