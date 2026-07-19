---
name: e2e-s2a-jihuayu-proxy-decommissioned
description: 旧 e2e/ 里 s2a.jihuayu.site 代理签发的凭据(OPENAI_*、CODEX_*、NICEEVAL_JUDGE_*)全部失效,api.deepseek.com 官方端点可平替 chat-completions 场景
metadata:
  type: infra-bug
---

**现象**：为 E2E 矩阵新仓库(`e2e/repos/*`)复用旧 `e2e/apps/*` `.env` 里的凭据时,
`OPENAI_API_KEY`(`OPENAI_BASE_URL=https://s2a.jihuayu.site/v1`)、`CODEX_API_KEY`
(`CODEX_BASE_URL=https://s2a.jihuayu.site/v1`)、`NICEEVAL_JUDGE_KEY`
(`NICEEVAL_JUDGE_BASE=https://s2a.jihuayu.site/v1`)三组凭据对 `/models` 一律返回
`401 {"code":"API_KEY_DISABLED"}`——即使把 `CODEX_API_KEY` 换到另一个存活的代理主机
(`s2a.niceeval.com`,`BUB_API_KEY` 在用)上仍然 401,证明是 key 本身被吊销,不是主机下线。
`BUB_API_KEY`/`BUB_API_BASE`(`s2a.niceeval.com`)与 `DEEPSEEK_API_KEY`/
`DEEPSEEK_BASE_URL`(`https://api.deepseek.com`,不带尾部 `/v1` 也能通)仍存活(`/models`
返回 200)。

**根因**：`s2a.jihuayu.site` 这个代理服务整体下线/凭据被吊销,与主机是否可达无关。

**修法**：
- 需要「随便一个能跑 chat-completions 协议的真实模型」的场景(`fromChatCompletion`/
  `fromResponses`、AI SDK 的 openai provider、judge autoevals):把对应 `.env` 变量的
  **值**换成 `DEEPSEEK_API_KEY` 的值 + `NICEEVAL_JUDGE_BASE`/`OPENAI_BASE_URL` 设为
  `https://api.deepseek.com`,变量**名**不用改,消费代码零改动——这是最省事的平替,已用于
  `results-contract`、`cli-contract`、`openai-compat`、`ai-sdk`、`langgraph` 的
  `OPENAI_*` 槽位,和全部 11 个仓库的 `NICEEVAL_JUDGE_*` 槽位。
- `codex-sdk`/`codex-cli` **不适用**这条平替:Codex 调的是 Responses API 协议、且模型/
  工具调用格式对 OpenAI 调过参,`@openai/codex-sdk` 的 `CodexOptions` 虽然暴露
  `baseUrl`/`apiKey`/`config`(可传 `model_provider.wire_api` 覆盖,验证过类型定义确实
  支持),但把它接到 DeepSeek 之后行为是否可靠未经验证——2026-07-18 与用户确认后**暂缓**
  这两个仓库,等一个真正对 Codex 友好的凭据,不要盲目平替。
- 判定「两个凭据是不是同一个」用非机密线索:字符长度(`awk -F= '{print
  $1"="length($2)"chars"}'`)、`/models` 的 HTTP 状态码——不要为了比较把值读进任何 agent
  上下文。
