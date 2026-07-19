// 基线 agent:无侵入用 niceeval 内置 claudeCodeAgent 适配器,接 DeepSeek 代理
// (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL 走 .env;模型由各 experiment 的 model 字段钉死)。
// experiments/coding.ts 用这个——coding-task(文件/shell 工具轨)与 session-resume
// (原生 resume 续接 + usage)都不需要额外挂载。
//
// 官方内置 sandbox agent:claudeCodeAgent() 已经在 niceeval 内部声明了
// coverage: completeCoverage,这里直接用不需要再声明(见适配器契约页)。
import { claudeCodeAgent } from "niceeval/adapter";

export default claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
});
