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
import { verifyMarketplaceName } from "./marketplace.ts";
import {
  appendNativeConfigFile,
  assertTomlNativeConfig,
  loadNativeConfigFile,
  type LoadedNativeConfig,
} from "./native-config.ts";
import { mapCodexSpans } from "../o11y/otlp/mappers/codex.ts";
import { t } from "../i18n/index.ts";
import { DEFAULT_CODEX_CLI_VERSION } from "./coding-cli-versions.ts";
import { assertMcpServers, isHttpMcp, mcpManifestEntries } from "./mcp.ts";
import { runPostSetupHooks } from "./post-setup.ts";
import type { Agent, AgentSetupManifest, McpServer, Sandbox, SandboxHook, SkillSpec } from "../types.ts";

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
 * `configFile` 的保留键:model / provider 路由 / 推理努力归 experiment 与 Adapter 的生成层,
 * MCP 表与 OTel 导出归 Adapter。清单定稿见 docs/feature/adapters/sdk/codex-cli/README.md。
 */
const RESERVED_CONFIG_KEYS = [
  "model",
  "model_provider",
  "model_providers",
  "model_reasoning_effort",
  "mcp_servers",
  "otel",
] as const;

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
    /**
     * sparse 拉取的路径列表,每项生成一个 `codex plugin marketplace add --sparse <path>`
     * (codex 的 `--sparse` 必须带路径参数、可重复):大仓库只取插件所需路径,省略或空数组即全量 clone。
     * 只影响拉取速度,不影响装出来的内容;manifest 不记录它。
     */
    sparse?: string[];
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
   * stdio 形态(command/args/env)写 [mcp_servers.<name>] 的 command 行;
   * Streamable HTTP 形态(url/headers)写 url 行,headers 进 [mcp_servers.<name>.http_headers] 子表。
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
  /**
   * 一份完整的 Codex `config.toml`(官方 TOML 格式)在本地项目里的路径 —— 相对运行
   * niceeval 的项目根(含 `niceeval.config.ts` 的目录)解析,不是 Sandbox 内路径;只接受
   * 项目根内的相对路径,包含 `..` 的路径、绝对路径、`~` 路径和解析后逃出项目根的符号链接
   * 都在 setup 阶段报错。原始字节原样并入沙箱里原本为空的用户级 `~/.codex/config.toml`
   * (不继承宿主机配置、不解析后重写);保留键 `model`、`model_provider`、`model_providers`、
   * `model_reasoning_effort`、`mcp_servers`、`otel` 出现在文件里 setup 报错。manifest 只记
   * 项目相对路径与字节 SHA-256,不落正文。
   */
  configFile?: string;
  /**
   * 安装后按数组顺序运行的用户钩子(复用 SandboxHook 的窄上下文):在写主配置、挂 MCP、
   * 装 Skills / Plugin、写 manifest 全部完成后执行,适合跑插件自带的 setup 脚本这类
   * 「安装产物就位后才能跑」的过程动作。钩子返回的 cleanup 按 LIFO 与 teardown 一起收尾;
   * 抛错按基础设施错误计(attempt errored)。
   * 见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」。
   */
  postSetup?: SandboxHook[];
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

      // 用户的原生配置文件:本地读原始字节 → 验 TOML 语法与保留键。字节 SHA-256 进
      // manifest 与安装 checkpoint key(见 native-config.ts 的 nativeConfigCheckpointItem)。
      let nativeConfig: LoadedNativeConfig | undefined;
      if (config?.configFile !== undefined) {
        nativeConfig = await loadNativeConfigFile({ agent: "codex", field: "configFile", path: config.configFile });
        assertTomlNativeConfig(nativeConfig, { agent: "codex", field: "configFile", reservedKeys: RESERVED_CONFIG_KEYS });
      }

      // model 归属:实验决定(ctx.model);省略时不写 model 行,交给 codex CLI 原生默认,
      // 不在 adapter 里硬编码一个会过期的模型名。
      const modelLine = ctx.model ? `model = "${ctx.model}"\n` : "";
      const effort = ctx.reasoningEffort ?? (ctx.flags.effort as string | undefined) ?? "medium";
      const base = getBaseUrl();

      const topLevel = base
        ? modelLine + `model_provider = "s2a"\n` + `model_reasoning_effort = "${effort}"\n`
        : `${modelLine}model_reasoning_effort = "${effort}"\n`;
      const providerTable = base
        ? `[model_providers.s2a]\n` +
          `name = "s2a"\n` +
          `base_url = "${base}"\n` +
          `env_key = "CODEX_API_KEY"\n` +
          `wire_api = "responses"\n`
        : "";

      if (!nativeConfig) {
        await shared.writeFile(
          sb,
          "~/.codex/config.toml",
          providerTable ? `${topLevel}\n${providerTable}` : topLevel,
        );
      } else {
        // codex 只读一份用户级 config.toml(没有 include / 第二配置层),Adapter 生成层与
        // 用户文件只能同文件分段共存。TOML 没有「回到根表」的语法,顶层键必须先于任何表头,
        // 所以布局固定为:Adapter 顶层键 → 用户文件原始字节(逐字节保留,自带表随意)→
        // Adapter 的表([model_providers.*] 以及后续追加的 [mcp_servers.*]、[otel])。
        // 保留键校验保证两层键不重叠,用户内容不被解析重写。
        await shared.writeFile(sb, "~/.codex/config.toml", topLevel);
        await appendNativeConfigFile(sb, nativeConfig, "~/.codex/config.toml");
        if (providerTable) {
          await sb.runShell(`cat >> ~/.codex/config.toml <<'NICEEVAL_PROVIDER_EOF'\n\n${providerTable}NICEEVAL_PROVIDER_EOF\n`);
        }
      }

      if (config?.mcpServers?.length) {
        assertMcpServers(config.mcpServers);
        const mcpToml = config.mcpServers
          .map((s) => {
            // 注意是复数 mcp_servers:单数 [mcp_server.x] 会被 codex 静默忽略,
            // MCP 压根挂不上(实测 codex-cli 0.142.x,`codex mcp list` 可核对)。
            const lines: string[] = [`[mcp_servers.${s.name}]`];
            if (isHttpMcp(s)) {
              lines.push(`url = "${s.url}"`);
              if (s.headers && Object.keys(s.headers).length) {
                lines.push(`[mcp_servers.${s.name}.http_headers]`);
                for (const [k, v] of Object.entries(s.headers)) lines.push(`"${k}" = "${v}"`);
              }
            } else {
              lines.push(`command = "${s.command}"`);
              if (s.args?.length) lines.push(`args = [${s.args.map((a) => `"${a}"`).join(", ")}]`);
              if (s.env && Object.keys(s.env).length) {
                lines.push(`[mcp_servers.${s.name}.env]`);
                for (const [k, v] of Object.entries(s.env)) lines.push(`${k} = "${v}"`);
              }
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
        // manifest 只记「挂了哪个 server、怎么连」;env / headers 里可能有 token,不落盘。
        manifest.mcpServers = mcpManifestEntries(config.mcpServers);
      }
      if (nativeConfig) {
        // 只记来源路径与字节哈希,不落正文(任意官方配置都可能带敏感字符串)。
        manifest.nativeConfigFile = { agent: "codex", path: nativeConfig.path, sha256: nativeConfig.sha256 };
      }
      if (
        manifest.skills.length ||
        manifest.nativePlugins?.length ||
        manifest.mcpServers?.length ||
        manifest.nativeConfigFile
      ) {
        await writeAgentSetupManifest(sb, manifest);
      }

      // 安装后钩子(postSetup):排在 manifest 之后——manifest 审计 Adapter 自身的安装事实,
      // 钩子失败不该丢掉这份证据。返回的合成 cleanup 交给 runner,与 teardown 一起 LIFO 收尾。
      return await runPostSetupHooks(sb, ctx, config?.postSetup);
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

      // `codex exec --json` 持续写出 ThreadEvent JSONL。把它压成短 step 送进 runner
      // progress，human dashboard 因而能显示真正的 tool / reasoning / assistant 活动；完整
      // transcript 仍在命令结束后一次解析并落入 events artifact，不能让 live 文案变成第二份结果。
      const onStdout = codexProgressReporter(ctx);
      const res = await sb.runShell(cmd, {
        env: { CODEX_API_KEY: getApiKey() },
        stream: true,
        onStdout,
      });

      const raw = shared.extractJsonlFromStdout(res.stdout);
      ctx.session.capture(shared.codexThreadId(res.stdout));
      const parsed = shared.parseCodex(raw);
      const events = [...parsed.events];
      if (res.exitCode !== 0) events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });
      return { events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

/** 把 Codex JSONL 的高频原始帧收敛成 dashboard 当前行的一条短 detail。 */
function codexProgressReporter(ctx: import("../types.ts").AgentContext): (chunk: string) => void {
  let remainder = "";
  return (chunk) => {
    remainder += chunk;
    const lines = remainder.split("\n");
    remainder = lines.pop() ?? "";
    for (const line of lines) {
      const detail = codexProgressDetail(line);
      if (detail) ctx.progress({ message: detail });
    }
  };
}

function codexProgressDetail(line: string): string | undefined {
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object") return undefined;
    event = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const item = event.item;
  if (!item || typeof item !== "object") return undefined;
  const data = item as Record<string, unknown>;
  const type = typeof data.type === "string" ? data.type : "";
  const completed = event.type === "item.completed";
  const preview = (value: unknown, limit = 96): string | undefined => {
    if (typeof value !== "string") return undefined;
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) return undefined;
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  };

  if (type === "command_execution") {
    const command = preview(data.command) ?? "shell";
    return completed ? `tool: ${command} · completed` : `tool: ${command}`;
  }
  if (type === "mcp_tool_call") {
    const tool = typeof data.tool === "string" ? data.tool : "MCP";
    const server = typeof data.server === "string" ? `${data.server}.` : "";
    return completed ? `tool: ${server}${tool} · completed` : `tool: ${server}${tool}`;
  }
  if (type === "web_search") return completed ? "tool: web search · completed" : "tool: web search";
  if (type === "file_change") return completed ? "tool: file change · completed" : "tool: file change";
  if (type === "reasoning") {
    const text = preview(data.text ?? data.content);
    return text ? `thinking: ${text}` : "thinking";
  }
  if (type === "agent_message") {
    const text = preview(data.text ?? data.message);
    return text ? `assistant: ${text}` : "assistant response";
  }
  return undefined;
}

/**
 * 先按 `marketplace.name` 连 Marketplace(同名只连一次,`--ref` 钉版本,add 后回读注册
 * 列表校验名字真的注册上了),再装指定 Plugin。
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
      // --sparse 只影响拉取速度,不影响装出来的内容;manifest 不记录它。
      const sparseFlags = (marketplace.sparse ?? [])
        .map((path) => ` --sparse ${shared.shellQuote(path)}`)
        .join("");
      const add = await sb.runShell(
        `codex plugin marketplace add ${shared.shellQuote(marketplace.source)}${refFlag}${sparseFlags}`,
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
      // add 静默按目标仓库 manifest 的 name 注册,错名会拖到 plugin add 才炸;
      // 回读注册列表立刻校验(契约与真机复现见 marketplace.ts 顶部说明)。
      await verifyMarketplaceName(sb, {
        agent: "codex",
        listCommand: "codex plugin marketplace list --json",
        marketplace,
        knownNames: connected,
      });
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
