// span mapper 入口:把各 agent 的原生 OTLP span 归一到 canonical GenAI semconv。
// 每个 mapper 是纯函数(不碰沙箱),住 core o11y、可独立单测。
//
// 分派不在这里:mapper 由各 Agent 通过 `spanMapper` 声明(见 types.ts Agent),
// 运行器只调接口 —— core 不按 agent 名字分支(架构规矩,见 docs/architecture.md)。
// 未声明 spanMapper 的 agent 走 canonical.ts 的通用 heuristic 兜底。
//
// 职责边界:本目录只管「发回来的 span 怎么读」;「沙箱里怎么让 agent 把 OTLP 发出来」
//(写 config.toml / 注入 OTEL_* env)是 adapter 侧的导出配置,与此分开。

export { mapCodexSpans } from "./codex.ts";
export { mapBubSpans } from "./bub.ts";
export { mapClaudeCodeSpans } from "./claude-code.ts";
export { mapGenericSpans } from "../canonical.ts";
