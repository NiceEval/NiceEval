import { completeCoverage } from "../scoring/coverage.ts";
import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import {
  appendProjectInstruction,
  installSkills,
  installedSkillNames,
  skillDiscoveryInstruction,
} from "./skills.ts";
import { writeAgentSetupManifest } from "./manifest.ts";
import { mapCodexSpans } from "../o11y/otlp/mappers/codex.ts";
import { t } from "../i18n/index.ts";
import { DEFAULT_CODEX_CLI_VERSION } from "./coding-cli-versions.ts";
import type { Agent, AgentSetupManifest, McpServer, Sandbox, SkillSpec } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// OpenAI Codex CLI 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `codex exec --json`,stdout JSONL → parseCodex → 标准事件流。
// 配置:鉴权本地(config / env),模型交给实验(ctx.model),推理努力程度经 ctx.reasoningEffort
// (兼容旧的 ctx.flags.effort),其余参数经 ctx.flags。
// 扩展(skill / plugin / MCP)是构造参数,setup 翻译成 codex 的原生形态并写 manifest。
// ───────────────────────────────────────────────────────────────────────────

/** codex 的 skill 目录(`skills` 生态的「通用」目录);codex 不原生扫描它,靠下面的发现指引。 */
const SKILL_DIR = ".agents/skills";

/**
 * Codex 的原生 Plugin —— **只属于 Codex**,不能传给 Claude Code(它有自己的
 * {@link import("./claude-code.ts").ClaudeCodePluginSpec})。字段当前相似不等于同一个类型:
 * 任一方的 Marketplace 鉴权、锁文件、选择规则或安装参数变化时,另一方不必接受无意义字段。
 */
export interface CodexPluginSpec {
  marketplace: {
    /** Marketplace 在 Codex 配置中的连接名(`codex plugin add <plugin>@<name>` 里的那个名字)。 */
    name: string;
    /** Marketplace 来源:`owner/repo`、Git URL 或本地路径。 */
    source: string;
    /** 固定 Marketplace 的 Tag、Commit 或 Branch(→ `codex plugin marketplace add --ref`)。 */
    ref?: string;
  };
  /** Marketplace 中的 Plugin 名。 */
  name: string;
}

export interface CodexConfig {
  /** 代理 / OpenAI API key。省略时读 CODEX_API_KEY env。 */
  apiKey?: string;
  /** OpenAI 兼容代理 base URL(如 https://s2a.example.com/v1)。省略时读 CODEX_BASE_URL env。 */
  baseUrl?: string;
  /**
   * 额外 MCP server(每个沙箱 setup 时追加进 ~/.codex/config.toml)。
   * 格式对应 codex config.toml 的 [mcp_servers.<name>] 表。
   */
  mcpServers?: McpServer[];
  /**
   * 装进沙箱的 Skill(本地目录/文件,或 repo + 可钉 ref + 可选启用集)。
   * 落在 `.agents/skills/<name>/`,并写一段发现指引进 AGENTS.md —— codex 没有 Claude Code 那种
   * 原生 Skill 工具,只把文件装进去它不会自己去读(见 memory/codex-no-native-skill-tool.md)。
   */
  skills?: SkillSpec[];
  /** Codex 原生 Plugin(先连 Marketplace,再从中装指定 Plugin)。 */
  plugins?: CodexPluginSpec[];
}

export function codexAgent(config?: CodexConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("CODEX_API_KEY");
  const getBaseUrl = () => config?.baseUrl ?? getEnv("CODEX_BASE_URL");

  return defineSandboxAgent({
    name: "codex",
    // 官方 adapter:transcript 经生命周期 fixture 验证,全通道 complete。
    coverage: completeCoverage,
    spanMapper: mapCodexSpans,

    async setup(sb, ctx) {
      // 预制模板已把 codex 烘焙进镜像(PATH 上)就跳过安装;否则 npm 全局装。
      await sb.runShell(
        `command -v codex >/dev/null 2>&1 || npm install -g @openai/codex@${DEFAULT_CODEX_CLI_VERSION}`,
      );

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

      const manifest: AgentSetupManifest = { skills: [] };
      if (config?.skills?.length) {
        manifest.skills = await installSkills(sb, config.skills, { dir: SKILL_DIR });
        // 发现指引不是可选装饰:没有它,codex 连一次读 skill 文件的 shell 调用都不会发生。
        await appendProjectInstruction(
          sb,
          skillDiscoveryInstruction(SKILL_DIR, installedSkillNames(manifest.skills)),
        );
      }
      if (config?.plugins?.length) {
        manifest.nativePlugins = await installPlugins(sb, config.plugins);
      }
      if (config?.mcpServers?.length) {
        // manifest 只记「挂了哪个 server、怎么起」;env 里可能有 token,不落盘。
        manifest.mcpServers = config.mcpServers.map((s) => ({
          name: s.name,
          command: s.command,
          ...(s.args?.length ? { args: [...s.args] } : {}),
        }));
      }
      if (manifest.skills.length || manifest.nativePlugins?.length || manifest.mcpServers?.length) {
        await writeAgentSetupManifest(sb, manifest);
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

/**
 * 先按 `marketplace.name` 连 Marketplace(同名只连一次,`--ref` 钉版本),再装指定 Plugin。
 * 只按 codex 自己的 marketplace / plugin 协议走 —— 与 claude-code 的实现不共用命令、不共用类型。
 */
export async function installPlugins(
  sb: Sandbox,
  plugins: readonly CodexPluginSpec[],
): Promise<NonNullable<AgentSetupManifest["nativePlugins"]>> {
  const connected = new Set<string>();
  const out: NonNullable<AgentSetupManifest["nativePlugins"]> = [];

  for (const plugin of plugins) {
    const { marketplace } = plugin;
    if (!connected.has(marketplace.name)) {
      const refFlag = marketplace.ref ? ` --ref ${shared.shellQuote(marketplace.ref)}` : "";
      const add = await sb.runShell(
        `codex plugin marketplace add ${shared.shellQuote(marketplace.source)}${refFlag}`,
      );
      if (add.exitCode !== 0) {
        throw new Error(
          t("plugin.marketplaceFailed", {
            agent: "codex",
            name: marketplace.name,
            source: marketplace.source,
            ref: marketplace.ref ?? "(default)",
            tail: outputTail(add),
          }),
        );
      }
      connected.add(marketplace.name);
    }

    const install = await sb.runShell(
      `codex plugin add ${shared.shellQuote(`${plugin.name}@${marketplace.name}`)}`,
    );
    if (install.exitCode !== 0) {
      throw new Error(
        t("plugin.installFailed", {
          agent: "codex",
          name: plugin.name,
          marketplace: marketplace.name,
          tail: outputTail(install),
        }),
      );
    }

    const resolvedVersion = await installedVersion(sb, plugin.name, marketplace.name);
    out.push({
      agent: "codex",
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

/**
 * `codex plugin list --json` 的版本回读;取不到不阻断安装(manifest 里 resolvedVersion 省略)。
 * 真实输出(实测 codex-cli 0.144.1)是 `{ installed: [...], available: [...] }`,已安装的这条在
 * `installed` 数组里,字段名是 `pluginId`(不是 `id`)——早前按裸数组 / `{ plugins: [...] }` 猜的
 * 形状全部猜错,`installedVersion` 曾对任何真实安装恒返回 undefined(见
 * memory/native-plugin-marketplace-name-not-caller-assignable.md 的姊妹发现,2026-07-13 e2e 复现)。
 */
async function installedVersion(sb: Sandbox, name: string, marketplace: string): Promise<string | undefined> {
  try {
    const res = await sb.runShell(`codex plugin list --json --marketplace ${shared.shellQuote(marketplace)}`);
    if (res.exitCode !== 0) return undefined;
    const raw = JSON.parse(res.stdout) as unknown;
    const list = (
      Array.isArray(raw) ? raw : ((raw as { installed?: unknown[] })?.installed ?? [])
    ) as {
      pluginId?: string;
      id?: string;
      name?: string;
      version?: string;
    }[];
    const hit = list.find((p) => p.pluginId === `${name}@${marketplace}` || p.id === `${name}@${marketplace}` || p.name === name);
    return typeof hit?.version === "string" ? hit.version : undefined;
  } catch {
    return undefined;
  }
}

function outputTail(res: { stdout: string; stderr: string }, n = 12): string {
  return (res.stdout + res.stderr).trim().split("\n").slice(-n).join("\n");
}

export default codexAgent();
