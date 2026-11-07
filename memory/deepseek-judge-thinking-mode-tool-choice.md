# judge.autoevals.closedQA 在纯 DeepSeek 网关下必错:"Thinking mode does not support this tool_choice"

**现象**：`examples/zh/eval/openllmetry`(应用 `.env` 只有 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 直指
`https://api.deepseek.com`,没有独立的真 OpenAI key)跑 `niceeval exp openllmetry` 时,gate 断言
(`calledTool`/`toolOrder`/`noFailedActions`/`messageIncludes`)全部通过,eval 整体 `passed`,但每条
`t.judge.autoevals.closedQA(...)` 都报
`evaluation error: 400 Thinking mode does not support this tool_choice`、判 0 分。换过
`judge.model` 为 `deepseek-v4-pro` 和 `deepseek-v4-flash` 结果一样。

**根因**:`src/scoring/judge.ts` 里 `ClosedQA`/`Factuality`/`Summary` 直接用 `autoevals` npm 包,
库内部会给评分请求强制一个 `tool_choice`(以结构化输出打分)。DeepSeek 的 chat completion 网关对
"thinking"(推理)模式的请求不接受被强制的 `tool_choice`——这是网关/上游模型的限制,不是 niceeval
`judge.ts` 自己拼的请求(`callJudge` 那条路径没有 tool_choice,出错的是 autoevals 内部自建的
OpenAI client 那条路径)。凡是 judge 复用应用同一对纯 DeepSeek 的 `OPENAI_API_KEY`/
`OPENAI_BASE_URL`(没有另配一个真支持 function-calling 强制 tool_choice 的网关,像
`examples/zh/eval/ai-sdk-v7/.env` 那样单独留一个 `OPENAI_BASE_URL=https://s2a.jihuayu.site/v1`)
就会踩到。

**修法**:因为 `.atLeast(0.7)` 是 soft 断言,评分错误按 0 分处理但不拖垮整条 eval 的 outcome(见
`loose-gate-regex-plus-soft-judge-false-pass.md`),所以确定性 gate 断言仍然是这类纯 DeepSeek 示例
里唯一可信的把关信号——写 eval 时别指望 judge 分数在这种环境下真的跑通,核心正确性判断放 gate
(`calledTool`/`messageIncludes`/`noFailedActions`),judge 只作为锦上添花、允许报错。真要修好 judge
本身,需要给 `niceeval.config.ts` 的 `judge` 单独配一个支持 function-calling 强制 tool_choice 的
OpenAI 兼容网关(`judge.baseUrl` + `judge.apiKeyEnv`),不要偷懒复用应用自己那个纯 DeepSeek 网关。
