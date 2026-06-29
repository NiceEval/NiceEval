import { defineSandboxAgent } from "../define.ts";
import { requireEnv } from "../util.ts";
import { shared } from "./shared.ts";
import type { Agent } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// Claude Code 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `claude` CLI,跑完读回 transcript JSONL → 标准事件流。
// ───────────────────────────────────────────────────────────────────────────

export interface ClaudeCodeConfig {
  /** Anthropic API key。省略时读 ANTHROPIC_API_KEY env。 */
  apiKey?: string;
}

export function claudeCodeAgent(config?: ClaudeCodeConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("ANTHROPIC_API_KEY");

  return defineSandboxAgent({
    name: "claude-code",
    capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true },

    async setup(sb) {
      await sb.runCommand("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      const args = ["--print", "--dangerously-skip-permissions"];
      if (ctx.model) args.push("--model", ctx.model);
      if (ctx.flags.webResearch) args.push("--allowedTools", "WebSearch,WebFetch");
      if (!ctx.session.isNew && ctx.session.id) args.push("--resume", ctx.session.id);
      args.push(input.text);

      const res = await sb.runCommand("claude", args, {
        env: { ANTHROPIC_API_KEY: getApiKey() },
        stream: true,
      });

      const raw = await shared.captureLatestJsonl(sb, "~/.claude/projects");
      ctx.session.id = shared.sessionIdFromClaudeTranscript(raw) ?? ctx.session.id;
      const parsed = shared.parseClaudeCode(raw);
      return { events: parsed.events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

export default claudeCodeAgent();
