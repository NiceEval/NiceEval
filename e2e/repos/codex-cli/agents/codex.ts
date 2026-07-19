// 基线 agent:无侵入用内置 codexAgent 适配器,接 s2a 代理(CODEX_API_KEY / CODEX_BASE_URL
// 走 .env;模型由各 experiment 的 model 字段钉死)。coding-task / session / usage 三条 Eval
// 共用它——内置 codexAgent 已经在 niceeval 自己内部声明了 completeCoverage,这里不需要
// 也不应该再包一层 defineAgent(那会丢失内置声明,见任务说明的已知坑)。
import { codexAgent } from "niceeval/adapter";

export default codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
});
