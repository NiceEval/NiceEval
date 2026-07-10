import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import { mapClaudeCodeSpans } from "../o11y/otlp/mappers/claude-code.ts";
import type { Agent, McpServer } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// Claude Code 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `claude` CLI,跑完读回 transcript JSONL → 标准事件流。
// ───────────────────────────────────────────────────────────────────────────

export interface ClaudeCodeConfig {
  /** Anthropic API key。省略时读 ANTHROPIC_API_KEY env。 */
  apiKey?: string;
  /**
   * 自定义 API base URL(代理 / 内网端点)。省略时读 ANTHROPIC_BASE_URL env;
   * 两者都没有则用 Anthropic 官方端点(claude CLI 默认行为)。
   */
  baseUrl?: string;
  /**
   * 最多跑几个 tool-use 轮次(→ `--max-turns`)。
   * 控制 eval 成本上限;省略时用 CLI 原生默认(无限制)。
   */
  maxTurns?: number;
  /**
   * 额外 MCP server(每个沙箱 setup 时写进用户级 ~/.claude.json)。
   * 示例:{ name: "browser", command: "npx", args: ["-y", "@anthropic/mcp-browser"] }
   */
  mcpServers?: McpServer[];
  /**
   * 额外安装的 skill，格式为 GitHub `"org/repo"`（如 `"Effect-TS/skills"`）。
   * setup 阶段在沙箱里执行 `npx skills add <org/repo>`；
   * 结果写进沙箱工作区的 skills-lock.json，claude CLI 启动时自动读取。
   */
  skills?: string[];
}

export function claudeCodeAgent(config?: ClaudeCodeConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("ANTHROPIC_API_KEY");
  const getBaseUrl = () => config?.baseUrl ?? getEnv("ANTHROPIC_BASE_URL");

  return defineSandboxAgent({
    name: "claude-code",
    spanMapper: mapClaudeCodeSpans,

    // claude CLI 原生 OTLP trace spans(beta):interaction / llm_request / tool 层级,
    // 需要 CLAUDE_CODE_ENHANCED_TELEMETRY_BETA 开关。
    tracing: {
      protocol: "http/protobuf",
      env: (endpoint) => ({
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
        CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
        // CLI 是短命进程:压短导出间隔,别让 span 死在退出前的批处理队列里。
        OTEL_TRACES_EXPORT_INTERVAL: "1000",
      }),
    },

    async setup(sb) {
      // 预制模板已把 claude 烘焙进镜像(PATH 上)就跳过安装;否则 npm 全局装。
      await sb.runShell("command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code");

      if (config?.mcpServers?.length) {
        const servers: Record<string, object> = {};
        for (const s of config.mcpServers) {
          servers[s.name] = {
            command: s.command,
            ...(s.args?.length && { args: s.args }),
            ...(s.env && { env: s.env }),
          };
        }
        // 用户级 MCP 配置在 ~/.claude.json(顶层 mcpServers 字段),不是 ~/.claude/claude.json
        // ——后者 claude CLI 根本不读,MCP 静默挂不上(本机 `claude mcp list` 可核对)。
        await shared.writeFile(sb, "~/.claude.json", JSON.stringify({ mcpServers: servers }, null, 2));
      }

      if (config?.skills?.length) {
        for (const source of config.skills) {
          // source = "Effect-TS/skills"（GitHub org/repo）
          // `npx skills add` 拉 repo、读 manifest、写 skills-lock.json，claude CLI 自动读取。
          // -y 跳过确认；-a claude-code 显式指定目标 CLI——不加这两个 flag 时命令会打印一个
          // "选择安装到哪些 agent" 的交互式多选框等 stdin，headless 沙箱里会一直卡到超时
          // (无 tty，选择框永远等不到输入)。
          await sb.runShell(`npx skills add ${shared.shellQuote(source)} -y -a claude-code`);
        }
      }
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      const args = ["--print", "--dangerously-skip-permissions"];
      if (ctx.model) args.push("--model", ctx.model);
      if (config?.maxTurns != null) args.push("--max-turns", String(config.maxTurns));
      if (ctx.flags.webResearch) args.push("--allowedTools", "WebSearch,WebFetch");
      if (ctx.session.id) args.push("--resume", ctx.session.id);
      args.push(input.text);

      const env: Record<string, string> = { ANTHROPIC_API_KEY: getApiKey(), ...ctx.telemetry?.env };
      const baseUrl = getBaseUrl();
      if (baseUrl) env["ANTHROPIC_BASE_URL"] = baseUrl;

      const res = await sb.runCommand("claude", args, { env, stream: true });

      // 「最新 jsonl」而非按 session id 精确定位:--resume 会 fork 新 session id 的新文件,
      // 精确匹配旧 id 会读到过期 transcript。send 串行,最新的一定是刚跑完的这次。
      const raw = await shared.captureLatestJsonl(sb, "~/.claude/projects");
      ctx.session.capture(shared.sessionIdFromClaudeTranscript(raw));
      const parsed = shared.parseClaudeCode(raw);
      const events = [...parsed.events];
      if (res.exitCode !== 0) events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });
      return { events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

export default claudeCodeAgent();
