// locked-down 实验专用:同一个 claude-code adapter,只挂一份 settingsFile,
// permissions.deny 关闭 WebSearch/WebFetch。send() 恒带 --dangerously-skip-permissions,
// 这份 settings 证明 deny 在这种模式下仍然生效(本机实测:被 deny 的工具从模型的工具列表
// 里直接消失,不是"调用时才被拦";见 docs/feature/adapters/sdk/claude-code/README.md
// 的 settingsFile 契约)。
import { claudeCodeAgent } from "niceeval/adapter";

export default claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  settingsFile: "configs/claude-code/no-web.json",
});
