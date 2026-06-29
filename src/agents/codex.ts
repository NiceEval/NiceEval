import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import type { Agent } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// OpenAI Codex CLI 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `codex exec --json`,stdout JSONL → parseCodex → 标准事件流。
// 配置:鉴权本地(config / env),模型交给实验(ctx.model),feature flags 经 ctx.flags。
// ───────────────────────────────────────────────────────────────────────────

export interface CodexConfig {
  /** 代理 / OpenAI API key。省略时读 CODEX_API_KEY env。 */
  apiKey?: string;
  /** OpenAI 兼容代理 base URL(如 https://s2a.example.com/v1)。省略时读 CODEX_BASE_URL env。 */
  baseUrl?: string;
}

export function codexAgent(config?: CodexConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("CODEX_API_KEY");
  const getBaseUrl = () => config?.baseUrl ?? getEnv("CODEX_BASE_URL");

  return defineSandboxAgent({
    name: "codex",
    capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true, tracing: true },

    async setup(sb, ctx) {
      await sb.runCommand("npm", ["install", "-g", "@openai/codex"]);

      const model = ctx.model ?? "gpt-5.4";
      const effort = (ctx.flags.effort as string | undefined) ?? "medium";
      const base = getBaseUrl();

      if (base) {
        await shared.writeFile(
          sb,
          "~/.codex/config.toml",
          `model = "${model}"\n` +
            `model_provider = "s2a"\n` +
            `model_reasoning_effort = "${effort}"\n\n` +
            `[model_providers.s2a]\n` +
            `name = "s2a"\n` +
            `base_url = "${base}"\n` +
            `env_key = "CODEX_API_KEY"\n` +
            `wire_api = "responses"\n`,
        );
      } else {
        await shared.writeFile(sb, "~/.codex/config.toml", `model = "${model}"\nmodel_reasoning_effort = "${effort}"\n`);
      }
    },

    tracing: {
      protocol: "http/json",
      async configure(sb, ctx) {
        const endpoint = ctx.telemetry!.endpoint;
        const otel =
          `\n[otel]\n` +
          `environment = "fasteval"\n` +
          `exporter = "none"\n` +
          `metrics_exporter = "none"\n\n` +
          `[otel.trace_exporter.otlp-http]\n` +
          `endpoint = "${endpoint}"\n` +
          `protocol = "json"\n`;
        await sb.runShell(`cat >> ~/.codex/config.toml <<'EOF'\n${otel}EOF\n`);
      },
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      const flags = "--json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check";
      const escaped = input.text.replace(/'/g, "'\\''");
      const resuming = !ctx.session.isNew && ctx.session.id;
      const cmd = resuming
        ? `codex exec resume ${ctx.session.id} ${flags} '${escaped}'`
        : `codex exec ${flags} '${escaped}'`;

      const res = await sb.runShell(cmd, { env: { CODEX_API_KEY: getApiKey() }, stream: true });

      const raw = shared.extractJsonlFromStdout(res.stdout);
      ctx.session.id = shared.codexThreadId(res.stdout) ?? ctx.session.id;
      const parsed = shared.parseCodex(raw);
      return { events: parsed.events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

export default codexAgent();
