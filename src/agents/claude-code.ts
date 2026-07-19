import { completeCoverage } from "../scoring/coverage.ts";
import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import { cloneRepo, installSkills } from "./skills.ts";
import { writeAgentSetupManifest } from "./manifest.ts";
import { verifyMarketplaceName } from "./marketplace.ts";
import {
  assertJsonNativeConfig,
  loadNativeConfigFile,
  uploadNativeConfigFile,
  type LoadedNativeConfig,
} from "./native-config.ts";
import { mapClaudeCodeSpans } from "../o11y/otlp/mappers/claude-code.ts";
import { t } from "../i18n/index.ts";
import { DEFAULT_CLAUDE_CODE_CLI_VERSION } from "./coding-cli-versions.ts";
import { assertMcpServers, isHttpMcp, mcpManifestEntries } from "./mcp.ts";
import { runPostSetupHooks, runPreTeardownHooks } from "./post-setup.ts";
import type { Agent, AgentSetupManifest, McpServer, Sandbox, SandboxHook, SkillSpec } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// Claude Code 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `claude` CLI,跑完读回 transcript JSONL → 标准事件流。
// 扩展(skill / plugin / MCP)全部是构造参数,setup 里翻译成 Claude Code 的原生形态,
// 装完写一份 manifest(见 docs/feature/adapters/architecture/coding-agent-extensions.md)。
// ───────────────────────────────────────────────────────────────────────────

/** Claude Code 的 skill 目录(project 级):CLI 原生扫描它,不需要额外的发现指引。 */
const SKILL_DIR = ".claude/skills";

/** 沙箱里用户级 settings 的落点:`settingsFile` 的原始字节原样替换这份原本为空的用户层。 */
const SETTINGS_PATH = "~/.claude/settings.json";

/**
 * `settingsFile` 的保留键:`model` 归 experiment(经 `--model` flag),`env` 归 Adapter
 * (鉴权与 OTel 导出经进程环境变量注入)。清单定稿见 docs/feature/adapters/sdk/claude-code/README.md。
 */
const RESERVED_SETTINGS_KEYS = ["model", "env"] as const;

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
   * 控制评估用例成本上限;省略时用 CLI 原生默认(无限制)。
   */
  maxTurns?: number;
  /**
   * 额外 MCP server(每个 Sandbox setup 时写进用户级 ~/.claude.json)。
   * stdio 形态写 command(可带 args / env);Streamable HTTP 形态写 url(可带 headers,
   * 逐字进请求头),落成 { "type": "http", "url": …, "headers": … } 条目。
   */
  mcpServers?: McpServer[];
  /**
   * 装进 Sandbox 的 Skill(本地目录/文件,或 repo + 可钉 ref + 可选启用集)。
   * 落在 project 级 `.claude/skills/<name>/`,claude CLI 原生发现。
   */
  skills?: SkillSpec[];
  /** Claude Code 原生 Plugin(先连 Marketplace,再从中装指定 Plugin)。 */
  plugins?: ClaudeCodePluginSpec[];
  /**
   * 一份完整的 Claude Code `settings.json`(官方格式)在本地项目里的路径 —— 相对运行
   * niceeval 的项目根(含 `niceeval.config.ts` 的目录)解析,不是 Sandbox 内路径;只接受
   * 项目根内的相对路径,包含 `..` 的路径、绝对路径、`~` 路径和解析后逃出项目根的符号链接
   * 都在 setup 阶段报错。原始字节原样上传为 Sandbox 里原本为空的用户级 `~/.claude/settings.json`
   * (不继承宿主机配置、不拼接、不重新序列化);保留键 `model` 与 `env` 出现在文件里
   * setup 报错。manifest 只记项目相对路径与字节 SHA-256,不落正文。
   */
  settingsFile?: string;
  /**
   * 安装后按数组顺序运行的用户 Hook(复用 SandboxHook 的窄上下文):在写 settings、挂 MCP、
   * 装 Skills / Plugin、写 manifest 全部完成后执行,适合跑插件自带的 setup 脚本这类
   * 「安装产物就位后才能跑」的过程动作。抛错按基础设施错误计(attempt errored)。
   * 见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」。
   */
  postSetup?: SandboxHook[];
  /**
   * 与 `postSetup` 成对的收尾 Hook:按 `postSetup` 的逆序语义,在 agent 自己的 teardown 步骤
   * 之前执行(LIFO 镜像 —— `postSetup` 跑在 agent 安装之后,`preTeardown` 就跑在 agent 收尾
   * 之前),当且仅当 `postSetup` 的时点走到过才触发。抛错按基础设施错误计,由 teardown 段
   * 按 teardown-failed 诊断收束。
   * 见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」。
   */
  preTeardown?: SandboxHook[];
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

    async setup(sb, ctx) {
      // 预制模板已把 claude 烘焙进镜像(PATH 上)就跳过安装;否则 npm 全局装。
      await sb.runShell(
        `command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code@${DEFAULT_CLAUDE_CODE_CLI_VERSION}`,
      );

      // 原生配置文件最先落(安装顺序契约的第 1 步):本地读原始字节 → 验 JSON 语法与保留键
      // → 原样替换沙箱里原本为空的用户级 settings.json。字节 SHA-256 进 manifest 与安装
      // checkpoint key(见 native-config.ts 的 nativeConfigCheckpointItem)。
      let settings: LoadedNativeConfig | undefined;
      if (config?.settingsFile !== undefined) {
        settings = await loadNativeConfigFile({
          agent: "claude-code",
          field: "settingsFile",
          path: config.settingsFile,
        });
        assertJsonNativeConfig(settings, {
          agent: "claude-code",
          field: "settingsFile",
          reservedKeys: RESERVED_SETTINGS_KEYS,
        });
        await uploadNativeConfigFile(sb, settings, SETTINGS_PATH);
      }

      if (config?.mcpServers?.length) {
        assertMcpServers(config.mcpServers);
        const servers: Record<string, object> = {};
        for (const s of config.mcpServers) {
          servers[s.name] = isHttpMcp(s)
            ? {
                type: "http",
                url: s.url,
                ...(s.headers && Object.keys(s.headers).length && { headers: s.headers }),
              }
            : {
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
        // manifest 里只记「挂了哪个 server、怎么连」;env / headers 里可能有 token,不落盘。
        manifest.mcpServers = mcpManifestEntries(config.mcpServers);
      }
      if (settings) {
        // 只记来源路径与字节哈希,不落正文(任意官方配置都可能带敏感字符串)。
        manifest.nativeConfigFile = { agent: "claude-code", path: settings.path, sha256: settings.sha256 };
      }
      // 什么都没装就不写 manifest:空 artifact 不落文件(同 results 的落盘规则)。
      if (
        manifest.skills.length ||
        manifest.nativePlugins?.length ||
        manifest.mcpServers?.length ||
        manifest.nativeConfigFile
      ) {
        await writeAgentSetupManifest(sb, manifest);
      }

      // 安装后钩子(postSetup):排在 manifest 之后——manifest 审计 Adapter 自身的安装事实,
      // 钩子失败不该丢掉这份证据。
      await runPostSetupHooks(sb, ctx, config?.postSetup);
    },

    async teardown(sb, ctx) {
      // preTeardown 与 postSetup 成对:LIFO 镜像,先于 agent 自己的收尾步骤执行。
      // claude-code 目前没有其它收尾步骤,这段就是整个 teardown。
      await runPreTeardownHooks(sb, ctx, config?.preTeardown);
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
 * 先按 `marketplace.name` 建立 Marketplace 连接(同名只连一次,add 后回读注册列表校验
 * 名字真的注册上了),再从该连接装指定 Plugin。
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
      // add 静默按目标仓库 manifest 的 name 注册,错名会拖到 plugin install 才炸;
      // 回读注册列表立刻校验(契约与真机复现见 marketplace.ts 顶部说明)。
      await verifyMarketplaceName(sb, {
        agent: "claude-code",
        listCommand: "claude plugin marketplace list --json",
        marketplace,
        knownNames: connected,
      });
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
