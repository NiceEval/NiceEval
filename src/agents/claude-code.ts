import { completeCoverage } from "../scoring/coverage.ts";
import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import { cloneRepo, installSkills } from "./skills.ts";
import { writeAgentSetupManifest } from "./manifest.ts";
import { mapClaudeCodeSpans } from "../o11y/otlp/mappers/claude-code.ts";
import { t } from "../i18n/index.ts";
import { DEFAULT_CLAUDE_CODE_CLI_VERSION } from "./coding-cli-versions.ts";
import type { Agent, AgentSetupManifest, McpServer, Sandbox, SkillSpec } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// Claude Code 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `claude` CLI,跑完读回 transcript JSONL → 标准事件流。
// 扩展(skill / plugin / MCP)全部是构造参数,setup 里翻译成 Claude Code 的原生形态,
// 装完写一份 manifest(见 docs/feature/adapters/architecture/coding-agent-extensions.md)。
// ───────────────────────────────────────────────────────────────────────────

/** Claude Code 的 skill 目录(project 级):CLI 原生扫描它,不需要额外的发现指引。 */
const SKILL_DIR = ".claude/skills";

/**
 * Claude Code 的原生 Plugin —— **只属于 Claude Code**,不能传给 Codex(Codex 有自己的
 * {@link import("./codex.ts").CodexPluginSpec})。每一项同时声明 Marketplace 连接和其中的 Plugin 名:
 * 连上 Marketplace 不等于启用它的全部 Plugin。
 */
export interface ClaudeCodePluginSpec {
  marketplace: {
    /** Marketplace 在 Claude Code 配置中的连接名(`claude plugin install <plugin>@<name>` 里的那个名字)。 */
    name: string;
    /** Marketplace 来源:GitHub `owner/repo`、Git URL 或路径。 */
    source: string;
    /** 固定 Marketplace 的 Tag、Commit 或 Branch;给了就先按 ref clone 下来再以本地路径连接。 */
    ref?: string;
  };
  /** Marketplace 中的 Plugin 名。 */
  name: string;
}

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
   * 装进沙箱的 Skill(本地目录/文件,或 repo + 可钉 ref + 可选启用集)。
   * 落在 project 级 `.claude/skills/<name>/`,claude CLI 原生发现。
   */
  skills?: SkillSpec[];
  /** Claude Code 原生 Plugin(先连 Marketplace,再从中装指定 Plugin)。 */
  plugins?: ClaudeCodePluginSpec[];
}

export function claudeCodeAgent(config?: ClaudeCodeConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("ANTHROPIC_API_KEY");
  const getBaseUrl = () => config?.baseUrl ?? getEnv("ANTHROPIC_BASE_URL");

  return defineSandboxAgent({
    name: "claude-code",
    // 官方 adapter:transcript 经生命周期 fixture 验证,全通道 complete。
    coverage: completeCoverage,
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
      await sb.runShell(
        `command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code@${DEFAULT_CLAUDE_CODE_CLI_VERSION}`,
      );

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

      const manifest: AgentSetupManifest = { skills: [] };
      if (config?.skills?.length) {
        manifest.skills = await installSkills(sb, config.skills, { dir: SKILL_DIR });
      }
      if (config?.plugins?.length) {
        manifest.nativePlugins = await installPlugins(sb, config.plugins);
      }
      if (config?.mcpServers?.length) {
        // manifest 里只记「挂了哪个 server、怎么起」;env 里可能有 token,不落盘。
        manifest.mcpServers = config.mcpServers.map((s) => ({
          name: s.name,
          command: s.command,
          ...(s.args?.length ? { args: [...s.args] } : {}),
        }));
      }
      // 什么都没装就不写 manifest:空 artifact 不落文件(同 results 的落盘规则)。
      if (manifest.skills.length || manifest.nativePlugins?.length || manifest.mcpServers?.length) {
        await writeAgentSetupManifest(sb, manifest);
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

      const env: Record<string, string> = {
        ANTHROPIC_API_KEY: getApiKey(),
        // Eval runs must not silently change CLI version after the sandbox artifact was built.
        DISABLE_AUTOUPDATER: "1",
        ...ctx.telemetry?.env,
      };
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

/**
 * 先按 `marketplace.name` 建立 Marketplace 连接(同名只连一次),再从该连接装指定 Plugin。
 * `claude plugin marketplace add` 没有钉 ref 的入口,所以要钉 ref 时先自己按 ref clone 下来,
 * 再以本地路径连接(CLI 支持 path 形态的 marketplace 源)—— 「来源必须可复现」不因 CLI 少个
 * flag 就打折。
 */
export async function installPlugins(
  sb: Sandbox,
  plugins: readonly ClaudeCodePluginSpec[],
): Promise<NonNullable<AgentSetupManifest["nativePlugins"]>> {
  const connected = new Set<string>();
  const out: NonNullable<AgentSetupManifest["nativePlugins"]> = [];

  for (const plugin of plugins) {
    const { marketplace } = plugin;
    if (!connected.has(marketplace.name)) {
      const source = marketplace.ref
        ? await cloneRepo(sb, marketplace.source, marketplace.ref)
        : marketplace.source;
      const add = await sb.runShell(`claude plugin marketplace add ${shared.shellQuote(source)}`);
      if (add.exitCode !== 0) {
        throw new Error(
          t("plugin.marketplaceFailed", {
            agent: "claude-code",
            name: marketplace.name,
            source: marketplace.source,
            ref: marketplace.ref ?? "(default)",
            tail: outputTail(add),
          }),
        );
      }
      connected.add(marketplace.name);
    }

    const id = `${plugin.name}@${marketplace.name}`;
    const install = await sb.runShell(`claude plugin install ${shared.shellQuote(id)}`);
    if (install.exitCode !== 0) {
      throw new Error(
        t("plugin.installFailed", {
          agent: "claude-code",
          name: plugin.name,
          marketplace: marketplace.name,
          tail: outputTail(install),
        }),
      );
    }

    const resolvedVersion = await installedVersion(sb, id);
    out.push({
      agent: "claude-code",
      marketplace: {
        name: marketplace.name,
        source: marketplace.source,
        ...(marketplace.ref !== undefined ? { ref: marketplace.ref } : {}),
      },
      name: plugin.name,
      ...(resolvedVersion !== undefined ? { resolvedVersion } : {}),
    });
  }
  return out;
}

/** `claude plugin list --json` → `[{ id: "<plugin>@<marketplace>", version, … }]`;取不到版本不阻断安装。 */
async function installedVersion(sb: Sandbox, id: string): Promise<string | undefined> {
  try {
    const res = await sb.runShell("claude plugin list --json");
    if (res.exitCode !== 0) return undefined;
    const list = JSON.parse(res.stdout) as { id?: string; version?: string }[];
    return list.find((p) => p.id === id)?.version;
  } catch {
    return undefined;
  }
}

function outputTail(res: { stdout: string; stderr: string }, n = 12): string {
  return (res.stdout + res.stderr).trim().split("\n").slice(-n).join("\n");
}

export default claudeCodeAgent();
