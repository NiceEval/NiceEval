---
format: concord.document/v1
id: origin-examples-real-ai-credentials
title: origin-examples-real-ai-credentials
createdAt: 2026-07-03T05:24:42+08:00
createdAtSource:
  kind: first-recorded
  path: memory/origin-examples-real-ai-credentials.md
  commit: eb582131f9cc4cccadc48a5a769e9b65062873b8
description: examples/zh/origin/{claude-agent-sdk,codex-sdk,custom-genai,langgraph,openllmetry,openinference}
  已删除 mock 模式，改用真实 DeepSeek/Codex 代理凭据；vm0 已按公开 REST 契约重写为真集成(见
  vm0-has-public-rest-contract)
kind: memory
memoryKind: insight
state: captured
epoch: 0
promotions: []
history: []
---

**背景**：这 6 个 origin 示例原本都有 `AGENT_MODE=mock`(默认，零配置离线跑)/`AGENT_MODE=ai`(真调用)两条路径。用户要求 origin 下不允许出现假 AI，2026-07-02 已批量删除 mock 分支，只保留真实调用路径，并从 `/Users/ctrdh/Code/coding-agent-memory-evals/.env` 搬了真实代理凭据过去(各自 `.env`，已在 `.gitignore` 里，未进 git)。

**凭据映射**(按目标 SDK 的鉴权协议分两组，不能混用)：
- **Anthropic 协议**(claude-agent-sdk，走 `query()` 的 `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`)：`ANTHROPIC_API_KEY=<DEEPSEEK_API_KEY>`，`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`(DeepSeek 官方 anthropic 兼容端点，注意路径带 `/anthropic`，和下面 OpenAI 协议组的 base URL 不同)，`model="deepseek-v4-flash"`。已在 `coding-agent-memory-evals` 的 `claudeCodeAgent` 实验里验证过同一套值。
- **OpenAI 兼容协议**(custom-genai / langgraph / openllmetry / openinference，走各自的 `openai` npm SDK 或 `langchain_openai.ChatOpenAI`)：`OPENAI_API_KEY=<DEEPSEEK_API_KEY 同一个 key>`，`OPENAI_BASE_URL=https://api.deepseek.com`(**不带** `/anthropic`)，`AGENT_MODEL=deepseek-v4-flash`。和 `examples/zh/eval/ai-sdk-v7/src/models.ts` 里的 deepseek provider 配置完全一致。
- **Codex Responses API**(codex-sdk，`new Codex({apiKey, baseUrl})`)：`CODEX_API_KEY`/`CODEX_BASE_URL=https://s2a.jihuayu.site/v1`(s2a 代理，`wire_api=responses`)，`AGENT_MODEL="gpt-5.4"`——和仓库内建 `codexAgent()`(`src/agents/codex.ts`)用的是同一个代理，已确认 SDK 的 `CodexOptions.apiKey/baseUrl` 直接映射到子进程 `env.CODEX_API_KEY` + `--config openai_base_url=...`，不需要 CLI 那套 `model_providers` TOML 手工配置。

**反直觉点**：DeepSeek 的 anthropic 兼容端点和 OpenAI 兼容端点是两个不同路径(`/anthropic` vs 无后缀)，同一个 `DEEPSEEK_API_KEY` 能通用，但 base URL 必须按协议分别设置，抄错会导致 404 或协议不匹配报错。

**其它连带修复**：claude-agent-sdk 和 codex-sdk 曾经默认端口都是 `PORT ?? 5189`(撞车)，已把 codex-sdk 改成 `5199`。vm0 目录当时按旧调研结论保持占位；2026-07-02 该结论被证伪，已重写为真集成(需要 `VM0_TOKEN` + `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` 作 run secrets，见 [[vm0-has-public-rest-contract]])。同日 origin 各 demo 的前后端接口按各 SDK 官方最佳实践重构：claude-agent-sdk 改 SSE 透传 SDKMessage(`includePartialMessages` + `resume`)，codex-sdk 改 `runStreamed()` ThreadEvent SSE(threadId 由前端持有)，langgraph 整体换成 **Python** `create_agent` + `langgraph dev` Agent Server(pip `langgraph-cli[inmem]`,venv 在 `.venv/`)+ React `@langchain/react` `useStream`(不再有自写 server，模型凭据仍是上面 OpenAI 兼容协议那组，经 `langgraph.json` 的 `env: ".env"` 加载;Python 版 LangSmith OTel 纯 env 驱动,无接线代码)。
