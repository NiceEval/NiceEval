import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import { mapCodexSpans } from "../o11y/otlp/mappers/codex.ts";
import type { Agent, McpServer } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// OpenAI Codex CLI 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `codex exec --json`,stdout JSONL → parseCodex → 标准事件流。
// 配置:鉴权本地(config / env),模型交给实验(ctx.model),推理努力程度经 ctx.reasoningEffort
// (兼容旧的 ctx.flags.effort),其余参数经 ctx.flags。
// ───────────────────────────────────────────────────────────────────────────

export interface CodexConfig {
  /** 代理 / OpenAI API key。省略时读 CODEX_API_KEY env。 */
  apiKey?: string;
  /** OpenAI 兼容代理 base URL(如 https://s2a.example.com/v1)。省略时读 CODEX_BASE_URL env。 */
  baseUrl?: string;
  /**
   * 额外 MCP server(每个沙箱 setup 时追加进 ~/.codex/config.toml)。
   * 格式对应 codex config.toml 的 [mcp_server.<name>] 表。
   */
  mcpServers?: McpServer[];
  /**
   * 额外安装的 skill，格式为 GitHub `"org/repo"`（如 `"Effect-TS/skills"`）。
   * setup 阶段执行 `npx skills add <org/repo>`，结果写进 skills-lock.json。
   */
  skills?: string[];
}

export function codexAgent(config?: CodexConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("CODEX_API_KEY");
  const getBaseUrl = () => config?.baseUrl ?? getEnv("CODEX_BASE_URL");

  return defineSandboxAgent({
    name: "codex",
    spanMapper: mapCodexSpans,

    async setup(sb, ctx) {
      // 预制模板已把 codex 烘焙进镜像(PATH 上)就跳过安装;否则 npm 全局装。
      await sb.runShell("command -v codex >/dev/null 2>&1 || npm install -g @openai/codex");

      // model 归属:实验决定(ctx.model);省略时不写 model 行,交给 codex CLI 原生默认,
      // 不在 adapter 里硬编码一个会过期的模型名。
      const modelLine = ctx.model ? `model = "${ctx.model}"\n` : "";
      const effort = ctx.reasoningEffort ?? (ctx.flags.effort as string | undefined) ?? "medium";
      const base = getBaseUrl();

      if (base) {
        await shared.writeFile(
          sb,
          "~/.codex/config.toml",
          modelLine +
            `model_provider = "s2a"\n` +
            `model_reasoning_effort = "${effort}"\n\n` +
            `[model_providers.s2a]\n` +
            `name = "s2a"\n` +
            `base_url = "${base}"\n` +
            `env_key = "CODEX_API_KEY"\n` +
            `wire_api = "responses"\n`,
        );
      } else {
        await shared.writeFile(sb, "~/.codex/config.toml", `${modelLine}model_reasoning_effort = "${effort}"\n`);
      }

      if (config?.mcpServers?.length) {
        const mcpToml = config.mcpServers
          .map((s) => {
            // 注意是复数 mcp_servers:单数 [mcp_server.x] 会被 codex 静默忽略,
            // MCP 压根挂不上(实测 codex-cli 0.142.x,`codex mcp list` 可核对)。
            const lines: string[] = [`[mcp_servers.${s.name}]`, `command = "${s.command}"`];
            if (s.args?.length) lines.push(`args = [${s.args.map((a) => `"${a}"`).join(", ")}]`);
            if (s.env && Object.keys(s.env).length) {
              lines.push(`[mcp_servers.${s.name}.env]`);
              for (const [k, v] of Object.entries(s.env)) lines.push(`${k} = "${v}"`);
            }
            return lines.join("\n");
          })
          .join("\n\n");
        await sb.runShell(`cat >> ~/.codex/config.toml <<'MCPEOF'\n\n${mcpToml}\nMCPEOF\n`);
      }

      if (config?.skills?.length) {
        for (const source of config.skills) {
          // 同 claude-code adapter:-y -a codex 避免无 tty 环境下卡在交互式 agent 选择框。
          // codex 没有 claude-code 那种原生 Skill 工具，装进的是 skills 包的"通用"目录
          // （`.agents/skills/<name>`）——codex CLI 本身不会主动去读它，要在 prompt 里
          // 显式提示"检查仓库里有没有 skill/guide 文件"，agent 才会用 shell 命令读进上下文。
          await sb.runShell(`npx skills add ${shared.shellQuote(source)} -y -a codex`);
        }
      }
    },

    tracing: {
      protocol: "http/json",
      async configure(sb, ctx) {
        const endpoint = ctx.telemetry!.endpoint;
        const otel =
          `\n[otel]\n` +
          `environment = "niceeval"\n` +
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
      const prompt = shared.shellQuote(input.text);
      const resuming = ctx.session.id;
      const cmd = resuming
        ? `codex exec resume ${ctx.session.id} ${flags} ${prompt}`
        : `codex exec ${flags} ${prompt}`;

      const res = await sb.runShell(cmd, { env: { CODEX_API_KEY: getApiKey() }, stream: true });

      const raw = shared.extractJsonlFromStdout(res.stdout);
      ctx.session.capture(shared.codexThreadId(res.stdout));
      const parsed = shared.parseCodex(raw);
      const events = [...parsed.events];
      if (res.exitCode !== 0) events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });
      return { events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

export default codexAgent();
