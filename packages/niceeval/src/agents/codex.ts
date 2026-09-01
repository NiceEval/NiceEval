import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { Effect } from "effect";
import { makeSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import {
  appendProjectInstruction,
  installSkills,
  installedSkillNames,
  skillDiscoveryInstruction,
} from "./skills.ts";
import { verifyMarketplaceName } from "./marketplace.ts";
import {
  appendNativeConfigFileEffect,
  assertTomlNativeConfig,
  loadNativeConfigFileEffect,
  type LoadedNativeConfig,
} from "./native-config.ts";
import { mapCodexSpans } from "../o11y/otlp/mappers/codex.ts";
import { DEFAULT_CODEX_CLI_VERSION, AGENT_BASELINE_RECIPE_REVISION } from "./coding-cli-versions.ts";
import { assertMcpServers, isHttpMcp, mcpManifestEntries } from "./mcp.ts";
import {
  registerAgentLifecycleHookCommands,
  runPostSetupHooks,
  runPreTeardownHooks,
} from "./post-setup.ts";
import { createNpmCliInstaller } from "./npm-staged.ts";
import type { Agent, AgentSetupManifest, McpServer, Sandbox, SkillSpec } from "../types.ts";
import type { SandboxCommand } from "../sandbox/commands.ts";
import type { AgentArtifactPlatform } from "./types.ts";
import {
  sendAcceptanceFromEvents,
  sendFailureText,
  type SendFailure,
} from "../context/send-failures.ts";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import type { FailureClass } from "../shared/failure-class.ts";
import { requireManagedProcessCapability } from "../sandbox/backend.ts";
import { attemptResources } from "../context/attempt-resources.ts";
import { sendCodexAppServer } from "./codex-app-server.ts";

// ───────────────────────────────────────────────────────────────────────────
// OpenAI Codex CLI 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里维护 Codex app-server stdio,原生通知 → 标准事件流。
// 配置:鉴权本地(config / env),模型交给实验(ctx.model),推理努力程度经 ctx.reasoningEffort,
// 其余参数经 ctx.flags。
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
    /** 目标仓库 manifest 声明的真实 name；CLI 不支持由调用方另取连接别名。 */
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
    sparse?: readonly string[];
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
   * 注入每次 Codex CLI 进程的额外环境变量。首轮 `codex exec` 与续轮 `codex exec resume`
   * 使用同一份声明；Codex 启动的 lifecycle Hook、MCP 动态 header 与命令子进程都会继承。
   * 值只经 Sandbox command options 传入，不拼进 shell 文本或写入 setup manifest，并全部按
   * 潜在敏感值从 timing / execution / error 证据中脱敏。`CODEX_API_KEY` 仍由 `apiKey` 或
   * 宿主同名环境变量提供，Adapter 的鉴权值会覆盖这里的同名键。
   * env value 不进入 carry 身份。会改变被测行为的非敏感值必须同时声明在 Experiment flags
   * 或所属 Plugin identity；只轮换凭据不会让旧结果失效。
   * `PATH` 是 Sandbox 受管变量，不接受经这里声明——出现即在 factory 构造时报错，改用
   * Sandbox factory 的 `pathPrepend`（见 docs/feature/sandbox/library.md）。
   */
  env?: Readonly<globalThis.Record<string, string>>;
  /**
   * 额外 MCP server(每个 Sandbox setup 时追加进 ~/.codex/config.toml)。
   * stdio 形态(command/args/env)写 [mcp_servers.<name>] 的 command 行;
   * Streamable HTTP 形态(url/headers)写 url 行,headers 进 [mcp_servers.<name>.http_headers] 子表。
   */
  mcpServers?: readonly McpServer[];
  /**
   * 装进 Sandbox 的 Skill(本地目录/文件,或 repo + 可钉 ref + 可选启用集)。
   * 落在 `.agents/skills/<name>/`,并写一段发现指引进 AGENTS.md —— codex 没有 Claude Code 那种
   * 原生 Skill 工具,只把文件装进去它不会自己去读(见 memory/codex-no-native-skill-tool.md)。
   */
  skills?: readonly SkillSpec[];
  /** Codex 原生 Plugin(先连 Marketplace,再从中装指定 Plugin)。 */
  plugins?: readonly CodexPluginSpec[];
  /**
   * 一份完整的 Codex `config.toml`(官方 TOML 格式)在本地项目里的路径 —— 相对运行
   * niceeval 的项目根(含 `niceeval.config.ts` 的目录)解析,不是 Sandbox 内路径;只接受
   * 项目根内的相对路径,包含 `..` 的路径、绝对路径、`~` 路径和解析后逃出项目根的符号链接
   * 都在 setup 阶段报错。原始字节原样并入 Sandbox 里原本为空的用户级 `~/.codex/config.toml`
   * (不继承宿主机配置、不解析后重写);保留键 `model`、`model_provider`、`model_providers`、
   * `model_reasoning_effort`、`mcp_servers`、`otel` 出现在文件里 setup 报错。manifest 只记
   * 项目相对路径与字节 SHA-256,不落正文。
   */
  configFile?: string;
  /**
   * 安装后按数组顺序运行的用户 Hook(复用 SandboxCommand 的窄上下文):在写主配置、挂 MCP、
   * 装 Skills / Plugin、写 manifest 全部完成后执行,适合跑插件自带的 setup 脚本这类
   * 「安装产物就位后才能跑」的过程动作。抛错按基础设施错误计(attempt errored)。
   * 见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」。
   */
  postSetup?: readonly SandboxCommand[];
  /**
   * 与 `postSetup` 成对的收尾 Hook:按 `postSetup` 的逆序语义,在 agent 自己的 teardown 步骤
   * 之前执行(LIFO 镜像 —— `postSetup` 跑在 agent 安装之后,`preTeardown` 就跑在 agent 收尾
   * 之前),当且仅当 `postSetup` 的时点走到过才触发。抛错按基础设施错误计,由 teardown 段
   * 按 teardown-failed 诊断收束。
   * 见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」。
   */
  preTeardown?: readonly SandboxCommand[];
}

const CODEX_CAPACITY_CODES = new Set([
  "ADMISSION_FAILED",
  "ADMISSION_FAILURE",
  "ADMISSION_REJECTED",
  "MODEL_AT_CAPACITY",
  "MODEL_CAPACITY",
  "MODEL_OVERLOADED",
]);

function normalizedCodexCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().toUpperCase().replace(/[ -]+/g, "_");
}

function codexCapacityCode(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  for (const line of raw.split("\n")) {
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object") continue;
      const record = value as globalThis.Record<string, unknown>;
      const error = record.error;
      const candidates = [
        record.code,
        record.reason,
        record.type,
        error && typeof error === "object" ? (error as globalThis.Record<string, unknown>).code : undefined,
        error && typeof error === "object" ? (error as globalThis.Record<string, unknown>).reason : undefined,
        error && typeof error === "object" ? (error as globalThis.Record<string, unknown>).type : undefined,
      ];
      const code = candidates.map(normalizedCodexCode).find((candidate) => candidate !== undefined && CODEX_CAPACITY_CODES.has(candidate));
      if (code !== undefined) return code;
    } catch {
      // Native stderr fallback is handled separately and remains deliberately narrow.
    }
  }
  return undefined;
}

function codexCapacityMessage(raw: string | undefined): string {
  if (raw === undefined) return "";
  const messages: string[] = [];
  for (const line of raw.split("\n")) {
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object") continue;
      const record = value as globalThis.Record<string, unknown>;
      if (record.type !== "turn.failed" && record.type !== "response.failed") continue;
      const error = record.error;
      if (error && typeof error === "object") {
        const message = (error as globalThis.Record<string, unknown>).message;
        if (typeof message === "string") messages.push(message);
      }
    } catch {
      // Native stderr fallback is handled separately and remains deliberately narrow.
    }
  }
  return messages.join("\n");
}

const CODEX_CAPACITY_TEXT = /\bmodel(?:[ _-]+is)?[ _-]+at[ _-]+capacity\b|\badmission[ _-]+(?:failed|failure|rejected)\b/i;

function codexCapacityFromFailure(failure: SendFailure): boolean {
  if (failure.acceptance !== "rejected") return false;
  if (failure.events !== undefined && sendAcceptanceFromEvents(failure.events) === "started") return false;
  for (let cause = failure.cause; cause !== undefined;) {
    if (cause._tag === "Error" || cause._tag === "Object") {
      const code = cause.code._tag === "Present" ? normalizedCodexCode(cause.code.value) : undefined;
      if (code !== undefined && CODEX_CAPACITY_CODES.has(code)) return true;
      cause = cause.cause._tag === "Cause" ? cause.cause.value : undefined;
      continue;
    }
    cause = undefined;
  }
  return CODEX_CAPACITY_TEXT.test(sendFailureText(failure));
}

function classifyCodexSendFailure(failure: SendFailure): FailureClass | undefined {
  return codexCapacityFromFailure(failure) ? { retryable: true, reason: "model_capacity" } : undefined;
}

function codexAcceptance(
  raw: string | undefined,
  events: readonly import("../types.ts").StreamEvent[],
  nativeErrorText = "",
): "rejected" | "started" | "unknown" {
  const acceptance = sendAcceptanceFromEvents(events);
  if (acceptance === "started") return "started";
  return codexCapacityCode(raw) !== undefined || CODEX_CAPACITY_TEXT.test(`${codexCapacityMessage(raw)}\n${nativeErrorText}`)
    ? "rejected"
    : acceptance;
}

/**
 * `@openai/codex` 的 npm 主包只是个 node shim,真正的 CLI 在平台包里
 * (`npm:@openai/codex@<ver>-linux-arm64`),是自带运行时的 musl 静态二进制。
 * 装这一份:沙箱里不需要 node / npm,任务镜像带什么都能装。
 */
function codexPlatformPackage(
  platform: AgentArtifactPlatform,
  version: string,
): { spec: string; binPath: string } | undefined {
  const target =
    platform.os === "linux" && platform.arch === "x64"
      ? { suffix: "linux-x64", triple: "x86_64-unknown-linux-musl" }
      : platform.os === "linux" && platform.arch === "arm64"
        ? { suffix: "linux-arm64", triple: "aarch64-unknown-linux-musl" }
        : platform.os === "darwin" && platform.arch === "x64"
          ? { suffix: "darwin-x64", triple: "x86_64-apple-darwin" }
          : platform.os === "darwin" && platform.arch === "arm64"
            ? { suffix: "darwin-arm64", triple: "aarch64-apple-darwin" }
            : undefined;
  if (target === undefined) return undefined;
  return {
    spec: `@openai/codex@${version}-${target.suffix}`,
    binPath: `vendor/${target.triple}/bin/codex`,
  };
}

// Codex 0.144.1 会把「hook 命令已正常退出、随后写 stdin 撞 BrokenPipe」误判成 hook
// 失败并丢掉 stdout。0.146.0 的官方 command runner 已忽略这个竞态；配置 Plugin 时必须
// 选择包含该修复的 CLI。未配置 Plugin 的官方基线仍保持当前已发布版本，避免引用尚未发布
// 的 Docker/E2B 制品。
const CODEX_PLUGIN_HOOK_SAFE_CLI_VERSION = "0.146.0";

export function codexAgent(config?: CodexConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("CODEX_API_KEY");
  const getBaseUrl = () => config?.baseUrl ?? getEnv("CODEX_BASE_URL");
  // PATH 是 Sandbox 受管变量,在 factory 构造时(link/配置校验期)同步拒绝,不留到 setup()
  // 才炸,也不静默丢弃——被覆盖的 PATH 会让 hooks / 子进程读到错误的可执行文件而零报错
  // (见 docs/feature/sandbox/library.md「PATH:受管变量与 pathPrepend」)。
  if (config?.env && "PATH" in config.env) {
    throw new TypeError(`codexAgent config.env.PATH is not supported: PATH is a Sandbox-managed variable, so silently dropping or overriding it would break hooks and child processes without any error. Prepend directories to it with the Sandbox factory's pathPrepend option instead (see docs/feature/sandbox/library.md).`);
  }
  // factory 构造时快照：一份 Agent 配置服务并发 attempt，不能让调用方随后改原对象造成
  // 不同 run/resume 轮拿到不同 Space。值不进入 shell 或 manifest，只交给 command options。
  const agentEnv = Object.freeze({ ...(config?.env ?? {}) });
  const agentEnvSensitiveValues = Object.freeze(Object.values(agentEnv));
  const cliVersion = config?.plugins?.length
    ? CODEX_PLUGIN_HOOK_SAFE_CLI_VERSION
    : DEFAULT_CODEX_CLI_VERSION;
  const cliRecipeRevision = config?.plugins?.length
    ? "plugin-hook-safe-r1"
    : String(AGENT_BASELINE_RECIPE_REVISION.codex);
  const { ensure, installer } = createNpmCliInstaller({
    identity: {
      agent: "codex",
      version: cliVersion,
      revision: cliRecipeRevision,
    },
    packageName: "@openai/codex",
    bin: "codex",
    platformPackage: (platform) => codexPlatformPackage(platform, cliVersion),
    progress: {
      checking: `checking Codex CLI ${cliVersion}`,
      installing: `installing official OpenAI Codex CLI ${cliVersion}`,
      ready: `Codex CLI ${cliVersion} ready`,
    },
  });

  return registerAgentLifecycleHookCommands(makeSandboxAgent({
    name: "codex",
    // 官方 adapter:transcript 经生命周期 fixture 验证,全通道 complete。
    evidenceCoverage: completeEvidenceCoverage,
    spanMapper: mapCodexSpans,
    classifySendFailure: classifyCodexSendFailure,
    ensure,
    installers: [installer],

    setup: (sb, ctx) => Effect.gen(function* () {
      yield* Effect.try({ try: () => requireManagedProcessCapability(sb, "codex"), catch: (cause) => cause });
      // 用户的原生配置文件:本地读原始字节 → 验 TOML 语法与保留键。字节 SHA-256 进
      // manifest 与安装 checkpoint key(见 native-config.ts 的 nativeConfigCheckpointItem)。
      let nativeConfig: LoadedNativeConfig | undefined;
      if (config?.configFile !== undefined) {
        nativeConfig = yield* loadNativeConfigFileEffect({ agent: "codex", field: "configFile", path: config.configFile });
        yield* Effect.try({
          try: () => assertTomlNativeConfig(nativeConfig!, {
            agent: "codex",
            field: "configFile",
            reservedKeys: RESERVED_CONFIG_KEYS,
          }),
          catch: (cause) => cause,
        });
      }

      // Codex 把 Plugin 的声明态写在 config.toml、安装体写在 cache。必须在覆盖用户配置前
      // 同时摘掉两边：覆盖后 `plugin list` 已看不见旧声明，旧安装体却仍会影响下一次 add
      // 的版本选择。先完整收敛，再写本 Attempt 的唯一配置层。
      if (config?.plugins?.length) {
        const plugins = config.plugins;
        yield* Effect.tryPromise({
          try: () => resetPluginState(sb, plugins),
          catch: (cause) => cause,
        });
      }

      // model 归属:实验决定(ctx.model);省略时不写 model 行,交给 codex CLI 原生默认,
      // 不在 adapter 里硬编码一个会过期的模型名。
      const modelLine = ctx.model ? `model = "${ctx.model}"\n` : "";
      const effortLine = ctx.reasoningEffort === undefined
        ? ""
        : `model_reasoning_effort = "${ctx.reasoningEffort}"\n`;
      const base = getBaseUrl();
      // 自定义 endpoint 常从项目的私有环境注入。它仍是 Codex 的真实运行配置，但不能因
      // Adapter 用 heredoc 写 config.toml 而进入 command/timing/error 证据；一旦在这里登记，
      // Attempt 最终封口也会清掉随后 hook 或 CLI 错误里回显的同一值。
      const providerSensitiveValues = base ? [base] : [];

      const topLevel = base
        ? modelLine + `model_provider = "s2a"\n` + effortLine
        : modelLine + effortLine;
      const providerTable = base
        ? `[model_providers.s2a]\n` +
          `name = "s2a"\n` +
          `base_url = "${base}"\n` +
          `env_key = "CODEX_API_KEY"\n` +
          `wire_api = "responses"\n`
        : "";

      if (!nativeConfig) {
        yield* Effect.tryPromise({
          try: () => shared.writeFile(
            sb,
            "~/.codex/config.toml",
            providerTable ? `${topLevel}\n${providerTable}` : topLevel,
            { sensitiveValues: providerSensitiveValues },
          ),
          catch: (cause) => cause,
        });
      } else {
        // codex 只读一份用户级 config.toml(没有 include / 第二配置层),Adapter 生成层与
        // 用户文件只能同文件分段共存。TOML 没有「回到根表」的语法,顶层键必须先于任何表头,
        // 所以布局固定为:Adapter 顶层键 → 用户文件原始字节(逐字节保留,自带表随意)→
        // Adapter 的表([model_providers.*] 以及后续追加的 [mcp_servers.*]、[otel])。
        // 保留键校验保证两层键不重叠,用户内容不被解析重写。
        yield* Effect.tryPromise({
          try: () => shared.writeFile(sb, "~/.codex/config.toml", topLevel),
          catch: (cause) => cause,
        });
        yield* appendNativeConfigFileEffect(sb, nativeConfig, "~/.codex/config.toml");
        if (providerTable) {
          yield* Effect.tryPromise({
            try: (signal) => sb.runShell(
              `cat >> ~/.codex/config.toml <<'NICEEVAL_PROVIDER_EOF'\n\n${providerTable}NICEEVAL_PROVIDER_EOF\n`,
              { signal, sensitiveValues: providerSensitiveValues },
            ),
            catch: (cause) => cause,
          });
        }
      }

      yield* Effect.tryPromise({
        try: async (signal) => {
          if (config?.mcpServers?.length) {
            assertMcpServers(config.mcpServers);
            const sensitiveValues: string[] = [];
            const mcpToml = config.mcpServers
              .map((s) => {
                // 注意是复数 mcp_servers:单数 [mcp_server.x] 会被 codex 静默忽略,
                // MCP 压根挂不上(实测 codex-cli 0.142.x,`codex mcp list` 可核对)。
                const lines: string[] = [`[mcp_servers.${s.name}]`];
                if (isHttpMcp(s)) {
                  lines.push(`url = "${s.url}"`);
                  const headers = s.headers;
                  if (headers && Object.keys(headers).length) {
                    lines.push(`[mcp_servers.${s.name}.http_headers]`);
                    for (const [k, v] of Object.entries(headers)) {
                      sensitiveValues.push(v);
                      lines.push(`"${k}" = "${v}"`);
                    }
                  }
                } else {
                  lines.push(`command = "${s.command}"`);
                  if (s.args?.length) lines.push(`args = [${s.args.map((a) => `"${a}"`).join(", ")}]`);
                  const env = s.env;
                  if (env && Object.keys(env).length) {
                    lines.push(`[mcp_servers.${s.name}.env]`);
                    for (const [k, v] of Object.entries(env)) {
                      sensitiveValues.push(v);
                      lines.push(`${k} = "${v}"`);
                    }
                  }
                }
                return lines.join("\n");
              })
              .join("\n\n");
            await sb.runShell(
              `cat >> ~/.codex/config.toml <<'MCPEOF'\n\n${mcpToml}\nMCPEOF\n`,
              { sensitiveValues, signal },
            );
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
            manifest.nativePlugins = await installPluginsFromResetState(sb, config.plugins);
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
            ctx.reportSetup(manifest);
          }

          // 安装后钩子(postSetup):排在 manifest 之后——manifest 审计 Adapter 自身的安装事实,
          // 钩子失败不该丢掉这份证据。
          await runPostSetupHooks(sb, ctx, "codex", config?.postSetup);
        },
        catch: (cause) => cause,
      });
    }),

    teardown: (sb, ctx) => Effect.tryPromise({
      try: async (signal) => {
        // preTeardown 与 postSetup 成对:LIFO 镜像,先于 agent 自己的收尾步骤执行。
        // codex 目前没有其它收尾步骤,这段就是整个 teardown。
        await runPreTeardownHooks(sb, { ...ctx, signal }, "codex", config?.preTeardown);
        await attemptResources(ctx)?.shutdownAll(signal);
      },
      catch: (cause) => cause,
    }),

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

    send: (input, ctx) => Effect.tryPromise({
      try: () => {
        const apiKey = getApiKey();
        return sendCodexAppServer(input, ctx, {
          ...agentEnv,
          CODEX_API_KEY: apiKey,
          ...ctx.telemetry?.env,
        }, (raw, events, nativeText) => {
          const code = codexCapacityCode(raw);
          return {
            acceptance: codexAcceptance(raw, events, nativeText),
            ...(code === undefined ? {} : { cause: normalizeExternalCause({ code }) }),
          };
        });
      },
      catch: (cause) => cause,
    }),
  }), config?.postSetup, config?.preTeardown);
}

/**
 * 先按 `marketplace.name` 连 Marketplace(同名只连一次,`--ref` 钉版本,add 后回读注册
 * 列表校验名字真的注册上了),再装指定 Plugin。
 * 只按 codex 自己的 marketplace / plugin 协议走 —— 与 claude-code 的实现不共用命令、不共用类型。
 *
 * 注册类命令是追加式的,而 Sandbox 复用下沙箱带着上一条 attempt 的 `$HOME` 进场,所以每一步
 * 先读沙箱真实状态、把它收敛到声明,再执行 add / install(契约见 docs/feature/adapters/
 * architecture/coding-agent-extensions.md「安装收敛:不假设沙箱空白」)。空白沙箱读回为空,
 * 走的是同一条代码路径。
 */
export async function installPlugins(
  sb: Sandbox,
  plugins: readonly CodexPluginSpec[],
): Promise<NonNullable<AgentSetupManifest["nativePlugins"]>> {
  await resetPluginState(sb, plugins);
  return installPluginsFromResetState(sb, plugins);
}

/**
 * 在 config.toml 仍保留上一条 Attempt 的 Plugin 声明时清理声明态与安装体。
 * setup 必须先调用它再覆盖 config；直接调用 installPlugins() 时也走同一收敛入口。
 */
async function resetPluginState(
  sb: Sandbox,
  plugins: readonly CodexPluginSpec[],
): Promise<void> {
  // 摘除顺序固定「先卸完全部同名插件、后摘 marketplace」:marketplace 注册一摘,
  // `codex plugin list` 就不再列出挂在它名下的安装(真机核对 codex-cli 0.146.0),
  // 残留的那份从此定位不到。多个插件共用一个 marketplace 时只需摘一次注册。
  for (const plugin of plugins) {
    await removeInstalledPlugins(sb, plugin.name);
  }

  const marketplaces = new Set<string>();
  for (const plugin of plugins) {
    if (marketplaces.has(plugin.marketplace.name)) continue;
    await dropRegisteredMarketplace(sb, plugin.marketplace.name);
    marketplaces.add(plugin.marketplace.name);
  }
}

/** 安装阶段只接受已经由 resetPluginState() 收敛过的 Sandbox。 */
async function installPluginsFromResetState(
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
        `${shared.agentBin("codex")} plugin marketplace add ${shared.shellQuote(marketplace.source)}${refFlag}${sparseFlags}`,
      );
      if (add.exitCode !== 0) {
        throw new Error(
          `Could not connect ${"codex"} marketplace "${marketplace.name}" (source: ${marketplace.source}, ref: ${marketplace.ref ?? "(default)"}):
${outputTail(add)}`,
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
      `${shared.agentBin("codex")} plugin add ${shared.shellQuote(`${plugin.name}@${marketplace.name}`)}`,
    );
    if (install.exitCode !== 0) {
      throw new Error(
        `Could not install ${"codex"} plugin "${plugin.name}" (marketplace: ${marketplace.name}):
${outputTail(install)}`,
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
 * `codex plugin list --json` 的已安装条目。真实输出(实测 codex-cli 0.144.1 / 0.146.0)是
 * `{ installed: [...], available: [...] }`,已安装的这条在 `installed` 数组里,字段名是
 * `pluginId`(不是 `id`)——早前按裸数组 / `{ plugins: [...] }` 猜的形状全部猜错,
 * `installedVersion` 曾对任何真实安装恒返回 undefined(见
 * memory/native-plugin-marketplace-name-not-caller-assignable.md 的姊妹发现,2026-07-13 e2e 复现)。
 * 形状按 CLI 宽容解析,抠不出(非 JSON / 未知形状)返回 undefined,由调用方决定放行还是抛错。
 */
interface CodexInstalledPlugin {
  pluginId?: string;
  id?: string;
  name?: string;
  marketplaceName?: string;
  version?: string;
}

function codexInstalledPlugins(stdout: string): CodexInstalledPlugin[] | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as { installed?: unknown }).installed
      : undefined;
  if (!Array.isArray(arr)) return undefined;
  return arr.filter((item): item is CodexInstalledPlugin => !!item && typeof item === "object");
}

/** 已安装条目的可寻址 id(`<plugin>@<marketplace>`);codex 的 remove 不接受裸插件名。 */
function codexPluginId(entry: CodexInstalledPlugin): string | undefined {
  const id =
    entry.pluginId ??
    entry.id ??
    (entry.name && entry.marketplaceName ? `${entry.name}@${entry.marketplaceName}` : undefined);
  return id?.includes("@") ? id : undefined;
}

/**
 * 与声明同名的 Plugin 已安装就先移除(不论它出自哪个 marketplace),让本条 attempt 的安装与
 * manifest 里的解析版本同源。已装即跳过会把上一条 attempt 装出的内容记成本条的安装事实。
 */
async function removeInstalledPlugins(sb: Sandbox, name: string): Promise<void> {
  const listCommand = "codex plugin list --json";
  const res = await sb.runShell(`${shared.agentBin("codex")} plugin list --json`);
  const list = res.exitCode === 0 ? codexInstalledPlugins(res.stdout) : undefined;
  if (list === undefined) {
    throw new Error(`Could not read the installed ${"codex"} plugin list (${listCommand}):
${outputTail(res)}`);
  }

  const ids = new Set<string>();
  for (const entry of list) {
    const id = codexPluginId(entry);
    if (id && (entry.name ?? id.split("@")[0]) === name) ids.add(id);
  }
  for (const id of ids) {
    const remove = await sb.runShell(`${shared.agentBin("codex")} plugin remove ${shared.shellQuote(id)}`);
    if (remove.exitCode !== 0) {
      throw new Error(`Could not remove the same-named installed ${"codex"} plugin "${id}":
${outputTail(remove)}
Installation converges the sandbox to the declaration: a leftover install under the same name is removed first, then reinstalled from the declared marketplace.`);
    }
  }
}

/**
 * 按声明名字无条件摘除同名 marketplace 注册,再由调用方按声明 source 与 ref 重新 add。
 * 不以「注册在 `marketplace list --json` 里可见」为前提:注册状态分两半——用户配置里的注册项
 * 和磁盘上的 marketplace 数据。原生配置整层替换会抹掉前一半,残下的后一半 list 报告不出来,
 * add 却会撞它报 `marketplace '<name>' is already added from a different source`
 * (复用沙箱第二条 attempt 真机复现,codex-cli 0.146.0;`remove` 对这种残根照样清得掉)。
 * 「本就没有可摘的」(`is not configured or installed`,exit 1)按已收敛处理;其它失败也不在
 * 这里报错——紧随其后的 add 是权威失败面,摘不干净它会带着 codex 的原话失败。
 */
async function dropRegisteredMarketplace(sb: Sandbox, name: string): Promise<void> {
  await sb.runShell(`${shared.agentBin("codex")} plugin marketplace remove ${shared.shellQuote(name)}`);
}

/** 装完回读版本;取不到不阻断安装(manifest 里 resolvedVersion 省略)。 */
async function installedVersion(sb: Sandbox, name: string, marketplace: string): Promise<string | undefined> {
  const res = await sb.runShell(`${shared.agentBin("codex")} plugin list --json --marketplace ${shared.shellQuote(marketplace)}`);
  if (res.exitCode !== 0) return undefined;
  const list = codexInstalledPlugins(res.stdout);
  const hit = list?.find(
    (p) => p.pluginId === `${name}@${marketplace}` || p.id === `${name}@${marketplace}` || p.name === name,
  );
  return typeof hit?.version === "string" ? hit.version : undefined;
}

function outputTail(res: { stdout: string; stderr: string }, n = 12): string {
  return (res.stdout + res.stderr).trim().split("\n").slice(-n).join("\n");
}

export default codexAgent();
