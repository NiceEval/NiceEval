// 全部 4 条 Eval 共用同一个 bubAgent 配置(agents/bub.ts),该配置在 setup() 阶段没有
// AGENTS.md 时会写一段通用的 Next.js 项目说明(见 src/agents/bub.ts),其中包含
// "verify with bash(\"cd <workspace> && npm run build\")"。本仓库的任务都不是真实的
// Next.js 项目,一个空 workspace 上跑 npm run build 必然失败,会污染 noFailedActions()/
// noFailedShellCommands() 这类断言。所有 send() 提示都带上这行免责说明,让 agent 不要
// 照做那条通用指引。
export const SKIP_BUILD_NOTE =
  "(Note: ignore the AGENTS.md instruction to verify with `npm run build` — " +
  "this workspace has no Next.js project, that command would just fail. Do not run it.) ";

// bub 的系统提示自带一段 "channel" 应答策略(见其 <response_instruct>):声称这里的纯文本
// 回复会被忽略,只有经某个 channel skill 发送才算真的回答了用户。真实运行中观察到:模型会
// 据此有时候在跑完工具调用后直接不产出任何 assistant 消息就结束这一轮("(no assistant
// messages)"),导致 messageIncludes() 断言 unavailable/failed——这是模型对"这个 channel
// 要不要显式应答"的真实判断分歧,不是配置错误。显式声明这里就是要一个纯文本回复,压低
// 这种分歧的概率。
export const REPLY_DIRECTIVE =
  "(Note: reply directly in this chat with plain text — a direct text reply here IS the correct " +
  "way to answer, do not end the turn without sending one.) ";
