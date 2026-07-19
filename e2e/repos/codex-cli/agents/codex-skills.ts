// Skill 实验专用:同一个 codex adapter,额外挂一个本仓库自带的本地 Skill
// (skills/niceeval-status-report/SKILL.md)——用 `kind: "local"` 而不是 `kind: "repo"`:
// 这个 Skill 只是给这一条 Eval 用的固定约定,不需要外部仓库,也避免了 native Plugin 那样
// 依赖沙箱里有 `git`(见 experiments/plugin.ts 的对比说明)。
//
// codex 没有 Claude Code 那种原生 Skill 工具,只把文件装进 `.agents/skills/` 不会自己去读——
// 必须显式提示才会去查(见 memory/codex-no-native-skill-tool.md),这条约束体现在
// evals/skill.eval.ts 的 prompt 里,不是这个 agent 配置的事。
import { codexAgent } from "niceeval/adapter";

export default codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  skills: [{ kind: "local", path: "skills/niceeval-status-report", name: "niceeval-status-report" }],
});
