import { defineSandboxAgent } from "../define.ts";
import { requireEnv } from "../util.ts";
import { shared } from "./shared.ts";
import {
  appendProjectInstruction,
  installSkills,
  installedSkillNames,
  skillDiscoveryInstruction,
} from "./skills.ts";
import { writeAgentSetupManifest } from "./manifest.ts";
import { mapGenericSpans } from "../o11y/otlp/canonical.ts";
import { parseOpenClawTranscript, parseOpenClawRunJson } from "../o11y/parsers/openclaw.ts";
import { randomUUID } from "node:crypto";
import type { Agent, AgentSetupManifest, EvidenceCoverage, SkillSpec, StreamEvent } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// OpenClaw 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `openclaw agent --local --json`(嵌入式 agent 循环,不依赖
// 长驻 gateway),读回结果封包 + session transcript → 标准事件流。方言解析全部住
// src/o11y/parsers/openclaw.ts,不进 core(契约见 docs/feature/adapters/sdk/openclaw/README.md)。
//
// 行为轨优先级(collection.md):session transcript(完整工具轨迹)优先;transcript 拿不到
// 时只保留 `--json` 封包的最终回复,不从最终文本猜工具行为——此时负断言不可信,send 会
// 经 ctx.log 明确记录这个限制。
// ───────────────────────────────────────────────────────────────────────────

// 契约要求实现前用真实 CLI fixture 钉版本;fixture 固定前先跟 npm latest 走,
// 钉死后归口 coding-cli-versions.ts(与 codex / claude-code 同源管理)。
const DEFAULT_OPENCLAW_CLI_VERSION = "latest";

/** OpenClaw 的 skill 目录(`skills` 生态的「通用」目录);发现靠 AGENTS.md 指引,不依赖原生扫描。 */
const SKILL_DIR = ".agents/skills";

export interface OpenClawConfig {
  /** 模型 API key(OpenClaw 默认走 Anthropic)。省略时读 ANTHROPIC_API_KEY env。 */
  apiKey?: string;
  /** 固定安装的 openclaw npm 版本(如 "1.2.3");省略时用内置默认。 */
  version?: string;
  /**
   * 装进沙箱的 Skill(本地目录/文件,或 repo + 可钉 ref + 可选启用集)。
   * 落在 `.agents/skills/<name>/`,并写一段发现指引进 AGENTS.md。
   */
  skills?: SkillSpec[];
}

/**
 * OpenClaw 的内置 sandbox Agent 工厂。复用 `defineSandboxAgent`、`shared` 安装工具、
 * `ctx.session` 存取器与 canonical OTel 通用 mapper(`mapGenericSpans`);OpenClaw 方言
 * (transcript / `agent --json` 字段)只住 `src/o11y/parsers/openclaw.ts`,不进 core。
 *
 * 会话契约:首轮显式发一个全新 session id 并 `ctx.session.capture()`(不依赖 OpenClaw 的
 * 默认主会话——否则相邻 attempt 会静默共享历史),后续轮用 `ctx.session.id` resume;
 * `t.newSession()` 后的新会话线自然拿到新 id,session 之间互相隔离。
 */
export function openClawAgent(config?: OpenClawConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("ANTHROPIC_API_KEY");
  const version = config?.version ?? DEFAULT_OPENCLAW_CLI_VERSION;

  // 契约(sdk/openclaw/README.md):只有 fixture 证明完整的行为才进入公开能力。transcript
  // 完整性尚未经真实 CLI fixture 验证,常态覆盖只声明 partial(不是 complete)——负断言在
  // 非 complete 通道上一律 unavailable,「明确限制负断言」由覆盖声明落实,不靠口头承诺。
  const FIXTURE_UNVERIFIED = "OpenClaw transcript completeness is not yet fixture-verified";
  const defaultCoverage: EvidenceCoverage = {
    events: { status: "partial", reason: FIXTURE_UNVERIFIED },
    actions: { status: "partial", reason: FIXTURE_UNVERIFIED },
    messages: { status: "partial", reason: FIXTURE_UNVERIFIED },
    usage: { status: "partial", reason: FIXTURE_UNVERIFIED },
  };

  return defineSandboxAgent({
    name: "openclaw",
    coverage: defaultCoverage,
    // OpenClaw 没有专属 span 方言 mapper:原生 span 走 canonical 通用 heuristic。
    // OTel 内容采集关闭时只影响 trace 证据面;行为轨(下面的 transcript 解析)不受影响。
    spanMapper: mapGenericSpans,

    tracing: {
      protocol: "http/protobuf",
      env: (endpoint) => ({
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
      }),
    },

    async setup(sb) {
      // 预制模板已把 openclaw 烘焙进镜像(PATH 上)就跳过安装;否则 npm 全局装。
      await sb.runShell(
        `command -v openclaw >/dev/null 2>&1 || npm install -g openclaw@${version}`,
      );

      const manifest: AgentSetupManifest = { skills: [] };
      if (config?.skills?.length) {
        manifest.skills = await installSkills(sb, config.skills, { dir: SKILL_DIR });
        // 发现指引跟着一起写:不提示 = 白装。
        await appendProjectInstruction(
          sb,
          skillDiscoveryInstruction(SKILL_DIR, installedSkillNames(manifest.skills)),
        );
      }
      if (manifest.skills.length) {
        await writeAgentSetupManifest(sb, manifest);
      }
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      // 会话契约:新会话线显式发新 session id(隔离);后续轮 resume 记录的 id。
      const sessionId = ctx.session.id ?? `niceeval-${sb.sandboxId}-${randomUUID().slice(0, 8)}`;
      ctx.session.capture(sessionId);

      const args = ["agent", "--local", "--session-id", sessionId, "--message", input.text, "--json"];
      const env: Record<string, string> = {
        ANTHROPIC_API_KEY: getApiKey(),
        ...ctx.telemetry?.env,
      };
      const res = await sb.runCommand("openclaw", args, { env, stream: true });

      const runJson = parseOpenClawRunJson(res.stdout);
      // 封包若带回服务端分配的 session key,后续轮以它为准(capture first-writer-wins,
      // 首轮已用自发 id 落地时不覆盖)。
      ctx.session.capture(runJson.sessionId);

      // 完整工具轨迹的唯一来源:session transcript。「最新 jsonl」而非按 session id 精确定位
      // (同 claude-code 的裁决:send 串行,最新的一定是刚跑完的这次;超时 fallback 若产生
      // 第二条 run,也落在同一个最新 transcript 里,单次读取不重复采集)。
      const raw = await shared.captureLatestJsonl(sb, "~/.openclaw/agents");
      const parsed = parseOpenClawTranscript(raw);
      const events: StreamEvent[] = [...parsed.events];

      // transcript 缺失 / 有解析不了的行:这一轮的工具轨迹不可信,coverage 降级说出来
      // (负断言由此落 unavailable,而不是在空流上假通过),不从最终文本猜工具行为。
      let turnCoverage: EvidenceCoverage | undefined;
      if (raw === undefined || parsed.events.length === 0) {
        const reason = "session transcript unavailable; only the --json final reply was collected";
        turnCoverage = {
          events: { status: "unavailable", reason },
          actions: { status: "unavailable", reason },
          usage: { status: "unavailable", reason },
        };
        ctx.log("openclaw transcript unavailable: tool trajectory missing for this turn, negative assertions are unreliable");
        if (runJson.text) events.push({ type: "message", role: "assistant", text: runJson.text });
      } else if (!parsed.parseSuccess) {
        const reason = "some transcript lines could not be parsed";
        turnCoverage = {
          events: { status: "partial", reason },
          actions: { status: "partial", reason },
        };
      }

      const failed = res.exitCode !== 0 || runJson.failed;
      if (failed) events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });

      // 用量:transcript 逐消息累加优先;transcript 没报时用封包摘要,都没有就是零值。
      const usage =
        parsed.usage.inputTokens > 0 || parsed.usage.outputTokens > 0
          ? parsed.usage
          : (runJson.usage ?? parsed.usage);

      return {
        events,
        usage,
        status: failed ? "failed" : "completed",
        ...(turnCoverage ? { coverage: turnCoverage } : {}),
      };
    },
  });
}

export default openClawAgent();
