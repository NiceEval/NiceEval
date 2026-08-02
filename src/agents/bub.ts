import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { defineSandboxAgent } from "../define.ts";
import { requireEnv } from "../util.ts";
import { shared } from "./shared.ts";
import {
  appendProjectInstruction,
  installSkills,
  installedSkillNames,
  skillDiscoveryInstruction,
} from "./skills.ts";
import { mapBubSpans } from "../o11y/otlp/mappers/bub.ts";
import { runPostSetupHooks, runPreTeardownHooks } from "./post-setup.ts";
import type { Agent, AgentSetupManifest, SkillSpec } from "../types.ts";
import type { SandboxCommand } from "../sandbox/commands.ts";
import { createHash, randomUUID } from "node:crypto";
import { t } from "../i18n/index.ts";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_REQUIREMENT,
  bubInstallHash,
  bubRequirement,
  normalizeBubPackages,
} from "./bub-install-spec.ts";
import { makeSendFailure, sendAcceptanceFromEvents } from "../context/send-failures.ts";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { shellQuote } from "../sandbox/shell.ts";
import { DEFAULT_BUB_VERSION } from "./coding-cli-versions.ts";

// ───────────────────────────────────────────────────────────────────────────
// bub 的 agent adapter(沙箱型)。
//
// ⚠️ 现实校正:bub 是 PyPI 上的 `bub`(alpha,Python 3.12),不是 npm 包。
//    · 安装:uv tool install bub(uv 自带 python 3.12,免 root)。
//    · 调用:bub run "<prompt>" --session-id <id> --workspace <path>
//    · 模型 + 代理:BUB_MODEL=openai:<model>、BUB_API_BASE、BUB_API_KEY。
//    · 记忆:tape(总是开),落盘在 ~/.bub/tapes/<md5(ws)[:16]>__<md5(sess)[:16]>.jsonl。
// ───────────────────────────────────────────────────────────────────────────

/**
 * Bub 的扩展单元 —— **只属于 Bub**:Bub 的插件是运行环境里的 Python Package,
 * 与 Claude Code / Codex 的 native plugin 没有共同的安装协议,不共用类型。
 */
export interface PythonPluginSpec {
  /** PyPI Package、Version Specifier 或 Git URL(如 `bub-plugin-memory==1.3.0`、`git+https://…@8f3c1a2`)。 */
  package: string;
}

export interface BubConfig {
  /** OpenAI 兼容代理的 API key。省略时读 BUB_API_KEY env。 */
  apiKey?: string;
  /** OpenAI 兼容代理的 base URL。省略时读 BUB_API_BASE env。 */
  apiBase?: string;
  /**
   * 装进 Sandbox 的 Skill(本地目录/文件,或 repo + 可钉 ref + 可选启用集)。
   * 落在 `.agents/skills/<name>/`,并写一段发现指引进 AGENTS.md(bub 没有原生 Skill 加载机制)。
   */
  skills?: SkillSpec[];
  /**
   * 装哪一版 Bub(PyPI 版本号,如 `"0.4.0"`)。省略时用 NiceEval 钉的默认版本;
   * 永远是确定版本,不装 latest —— 被测对象的版本要能从实验配置读出来。
   */
  version?: string;
  /**
   * OTel tape store 插件的 git 依赖(时间轨的来源)。省略时用 NiceEval 钉的默认 pin。
   *
   * 插件与 Bub 的 tape 协议同代:默认 pin 从 `bub.tape` 取类型,要求 Bub ≥ 0.3.10;更早的
   * 插件 commit 按 republic 的类型校验,配 Bub ≤ 0.3.9。配错代不会安装失败,而是 span 全被拒、
   * 时间轨静默为空 —— 所以往回钉 `version` 时必须同批钉配套的插件 commit。
   */
  otelPlugin?: string;
  /**
   * 额外装进 bub tool 环境的 Python Package,每个 Sandbox setup 时进 `uv tool install … --with <pkg>`。
   * 规范化后的 package 列表进安装 checkpoint key:plugin 集合不同的两个 agent 变体不会复用同一个
   * 安装 checkpoint(否则第二个变体会静默拿到第一个变体的环境)。
   */
  pythonPlugins?: PythonPluginSpec[];
  /**
   * 安装后按数组顺序运行的用户 Hook(复用 SandboxCommand 的窄上下文):在装 bub、装 Skills /
   * Python package、写 manifest 全部完成后执行。抛错按基础设施错误计(attempt errored)。
   * 见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」。
   */
  postSetup?: SandboxCommand[];
  /**
   * 与 `postSetup` 成对的收尾 Hook:按 `postSetup` 的逆序语义,在 agent 自己的 teardown 步骤
   * 之前执行(LIFO 镜像 —— `postSetup` 跑在 agent 安装之后,`preTeardown` 就跑在 agent 收尾
   * 之前),当且仅当 `postSetup` 的时点走到过才触发。抛错按基础设施错误计,由 teardown 段
   * 按 teardown-failed 诊断收束。
   * 见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」。
   */
  preTeardown?: SandboxCommand[];
}

const UV = "$HOME/.local/bin/uv";

/** bub 的 skill 目录(`skills` 生态的「通用」目录);bub 不原生扫描它,靠 AGENTS.md 的发现指引。 */
const SKILL_DIR = ".agents/skills";

// bub 与 OTel 插件的 pin 都从 config 来(缺省用源码里的默认 pin)——不设环境变量后门:
// 装哪个包是配置,配置的家是代码(边界见 docs/architecture.md「配置从代码来,凭据从环境来」)。
//
// override 文件不是历史包袱:插件所在 workspace 把 `bub` 声明成 git 依赖,不覆盖的话每次
// 安装都会去拉 Bub 主干,版本失控。所以安装前总是先把 `bub==<version>` 写进这个文件。
const BUB_OVERRIDE_FILE = "/tmp/bub-override.txt";

/** 一个 agent 变体装的那套 bub:requirement + OTel 插件,两者都进安装指纹。 */
interface BubInstallPin {
  requirement: string;
  otelPlugin: string;
}

function resolvePin(config?: BubConfig): BubInstallPin {
  return {
    requirement: config?.version ? bubRequirement(config.version) : DEFAULT_BUB_REQUIREMENT,
    otelPlugin: config?.otelPlugin ?? DEFAULT_BUB_OTEL_PLUGIN,
  };
}

// NiceEval 的预制配方与运行时安装都写到 $HOME/.local；显式使用该路径，避免 PATH 上
// 另一个未知版本的 bub 抢先命中。
const BUB = "$HOME/.local/bin/bub";

/** 规范化 python plugin:去空白、丢空串、去重 —— 安装命令与 checkpoint key 用同一份列表。 */
function normalizePackages(plugins?: readonly PythonPluginSpec[]): string[] {
  return normalizeBubPackages((plugins ?? []).map((plugin) => plugin.package));
}

function installHashOf(packages: readonly string[], pin: BubInstallPin): string {
  return bubInstallHash(packages, pin.requirement, pin.otelPlugin);
}

function tapePath(workspace: string, sessionId: string, bubHome: string): string {
  const w = createHash("md5").update(workspace).digest("hex").slice(0, 16);
  const s = createHash("md5").update(sessionId).digest("hex").slice(0, 16);
  return `${bubHome}/tapes/${w}__${s}.jsonl`;
}

export function bubAgent(config?: BubConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("BUB_API_KEY");
  const getApiBase = () => config?.apiBase ?? requireEnv("BUB_API_BASE");
  const packages = normalizePackages(config?.pythonPlugins);
  const pin = resolvePin(config);
  const identity = {
    agent: "bub",
    version: config?.version ?? DEFAULT_BUB_VERSION,
    revision: installHashOf(packages, pin),
  } as const;
  const marker = `$HOME/${BUB_INSTALL_MARKER}`;
  const probe = defineSandboxCommand(
    { id: "niceeval.agent.probe.bub", revision: identity.revision, inputs: identity },
    async (sandbox) => {
      await sandbox.runShellOrThrow(
        `test -x ${BUB} && test "$(cat ${marker} 2>/dev/null)" = ${shellQuote(identity.revision)}`,
      );
    },
  );
  // sandboxId → { home, workspace }; persists values detected in setup() so send() can use them.
  const sessionInfo = new Map<string, { home: string; workspace: string }>();

  return defineSandboxAgent({
    name: "bub",
    ensure: { identity, probe },
    installers: [{
      identity,
      installMode: "sandbox-network",
      install: async (sandbox) => {
        await sandbox.runShellOrThrow(`test -x ${UV} || (curl -LsSf https://astral.sh/uv/install.sh | sh)`);
        await sandbox.writeText(BUB_OVERRIDE_FILE, `${pin.requirement}\n`);
        const withPlugins = packages.map((pkg) => `--with ${shellQuote(pkg)}`).join(" ");
        let last = "";
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const result = await sandbox.runShell(
            `${UV} tool install --reinstall --python 3.12 --prerelease allow 'bub' --overrides ${BUB_OVERRIDE_FILE} --with ${shellQuote(pin.otelPlugin)}${withPlugins ? ` ${withPlugins}` : ""}`,
          );
          if (result.exitCode === 0) {
            await sandbox.runShellOrThrow(
              `mkdir -p "$(dirname ${marker})" && printf '%s' ${shellQuote(identity.revision)} > ${marker}`,
            );
            return;
          }
          last = (result.stdout + result.stderr).split("\n").slice(-15).join("\n");
        }
        throw new Error(t("bub.installFailed", { attempts: 3, tail: last }));
      },
    }],
    // 官方 adapter:transcript 经生命周期 fixture 验证,全通道 complete。
    evidenceCoverage: completeEvidenceCoverage,
    spanMapper: mapBubSpans,

    tracing: {
      protocol: "http/protobuf",
      env: (endpoint) => ({
        BUB_TAPESTORE_OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
      }),
    },

    async setup(sb, ctx) {
      // home 必须来自运行时探测:各 sandbox provider 不同(/home/node、/home/vercel-sandbox…),
      // 兜一个 provider 专属常量会静默走错路径(tape 读不到 → 空事件流 → 负断言假通过)。
      const home = (await sb.runShell("printf '%s' $HOME")).stdout.trim();
      if (!home) throw new Error(t("bub.homeDetectFailed"));
      const workspace = sb.workdir;
      sessionInfo.set(sb.sandboxId, { home, workspace });
      // Agent CLI 已由 runner 的 agent.ensure 循环完成安装与复检。
      // adapter setup 只写本 Attempt 的 runtime config。
      if (!(await sb.pathExists(`${workspace}/AGENTS.md`))) {
        await shared.writeFile(
          sb,
          `${workspace}/AGENTS.md`,
          [
            `You are a coding agent working in a Next.js project at ${workspace}.`,
            ``,
            `Implement the requested feature by writing files directly to disk with the available tools:`,
            `- fs_write(path, content): create or overwrite a file`,
            `- fs_edit(path, old, new): edit an existing file`,
            `- bash(cmd): run shell commands`,
            ``,
            `Do NOT respond with only a text explanation — write the actual code files.`,
            `After writing, verify with bash("cd ${workspace} && npm run build").`,
          ].join("\n"),
        );
      }

      const manifest: AgentSetupManifest = { skills: [] };
      if (config?.skills?.length) {
        manifest.skills = await installSkills(sb, config.skills, { dir: SKILL_DIR });
        // bub 没有原生 Skill 加载机制:装进目录不等于会被读到,发现指引跟着一起写。
        await appendProjectInstruction(
          sb,
          skillDiscoveryInstruction(SKILL_DIR, installedSkillNames(manifest.skills)),
        );
      }
      if (packages.length) manifest.pythonPlugins = packages.map((pkg) => ({ package: pkg }));
      if (manifest.skills.length || manifest.pythonPlugins?.length) {
        ctx.reportSetup(manifest);
      }

      // 安装后钩子(postSetup):排在 manifest 之后——manifest 审计 Adapter 自身的安装事实,
      // 钩子失败不该丢掉这份证据。
      await runPostSetupHooks(sb, ctx, "bub", config?.postSetup);
    },

    async teardown(sb, ctx) {
      // preTeardown 与 postSetup 成对:LIFO 镜像,先于 agent 自己的收尾步骤执行。
      // bub 目前没有其它收尾步骤,这段就是整个 teardown。
      await runPreTeardownHooks(sb, ctx, "bub", config?.preTeardown);
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      const info = sessionInfo.get(sb.sandboxId);
      if (!info) throw new Error(t("bub.setupNotRun"));
      const { home, workspace } = info;
      const bubHome = `${home}/.bub`;
      // 会话契约:ctx.session.id 未记录时开新 tape(新 sessionId),否则 resume 传入的 id。
      // tape 路径由 md5(workspace)+md5(sessionId) 决定,同沙箱多会话靠 sessionId 区分。
      const sessionId = ctx.session.id ?? `fe-${sb.sandboxId}-${randomUUID().slice(0, 8)}`;
      ctx.session.capture(sessionId);

      const env: globalThis.Record<string, string> = {
        BUB_API_KEY: getApiKey(),
        BUB_API_BASE: getApiBase(),
        BUB_HOME: bubHome,
        ...ctx.telemetry?.env,
      };
      // model 归属:实验决定(ctx.model),省略时交给 bub 原生默认 / 用户环境,不硬编码。
      if (ctx.model) env.BUB_MODEL = `openai:${ctx.model}`;
      const res = await sb.runShell(
        `${BUB} --workspace ${workspace} run ${shared.shellQuote(input.text)} --session-id ${sessionId}`,
        { env, stream: true },
      );

      const raw = await sb.readText(tapePath(workspace, sessionId, bubHome)).catch(() => undefined);
      const parsed = shared.parseBub(raw);
      const events = [...parsed.events];
      if (res.exitCode !== 0) {
        throw makeSendFailure({
          acceptance: sendAcceptanceFromEvents(events),
          message: shared.diagnoseFailure(res, parsed.events, raw),
          events,
          usage: parsed.usage,
          process: res,
        });
      }
      return { events, usage: parsed.usage, status: "completed" };
    },
  });
}

export default bubAgent();
