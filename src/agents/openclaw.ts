import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import {
  appendProjectInstruction,
  installSkills,
  installedSkillNames,
  skillDiscoveryInstruction,
} from "./skills.ts";
import { mapGenericSpans } from "../o11y/otlp/canonical.ts";
import { parseOpenClawTranscript, parseOpenClawRunJson } from "../o11y/parsers/openclaw.ts";
import { completeCoverage } from "../scoring/coverage.ts";
import { DEFAULT_OPENCLAW_CLI_VERSION } from "./coding-cli-versions.ts";
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

/** OpenClaw 的 skill 目录(`skills` 生态的「通用」目录);发现靠 AGENTS.md 指引,不依赖原生扫描。 */
const SKILL_DIR = ".agents/skills";
/** 自定义 OpenAI 兼容网关在 openclaw.json 里的 provider id。 */
const COMPAT_PROVIDER = "compat";

export interface OpenClawConfig {
  /** 模型 API key。省略时读 OPENCLAW_API_KEY,再回落 ANTHROPIC_API_KEY。 */
  apiKey?: string;
  /** OpenAI 兼容端点。省略时读 OPENCLAW_BASE_URL。 */
  baseUrl?: string;
  /** 固定安装的 openclaw npm 版本(如 "1.2.3");省略时用内置默认。 */
  version?: string;
  /**
   * 装进沙箱的 Skill(本地目录/文件,或 repo + 可钉 ref + 可选启用集)。
   * 落在 `.agents/skills/<name>/`,并写一段发现指引进 AGENTS.md。
   */
  skills?: SkillSpec[];
}

function resolveApiKey(config?: OpenClawConfig): string {
  return config?.apiKey ?? getEnv("OPENCLAW_API_KEY") ?? requireEnv("ANTHROPIC_API_KEY");
}

function resolveBaseUrl(config?: OpenClawConfig): string | undefined {
  return config?.baseUrl ?? getEnv("OPENCLAW_BASE_URL");
}

/** experiment.model → `--model`。裸模型名在自定义网关下补成 `compat/<model>`。 */
function resolveModelFlag(model: string | undefined, hasCompatBase: boolean): string | undefined {
  if (!model) return undefined;
  if (model.includes("/")) return model;
  return hasCompatBase ? `${COMPAT_PROVIDER}/${model}` : model;
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
  const version = config?.version ?? DEFAULT_OPENCLAW_CLI_VERSION;

  return defineSandboxAgent({
    name: "openclaw",
    // e2e 已用真实 CLI 证明 session transcript 能给出工具轨 / 消息 / 用量;
    // 采集失败的单轮仍会在 send 里把 coverage 降成 unavailable/partial。
    coverage: completeCoverage,
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

    async setup(sb, ctx) {
      // 预制模板已把 openclaw 烘焙进镜像(PATH 上)就跳过安装;否则 npm 全局装。
      await sb.runShell(
        `command -v openclaw >/dev/null 2>&1 || npm install -g openclaw@${version}`,
      );

      const baseUrl = resolveBaseUrl(config);
      if (baseUrl) {
        // OpenAI 兼容网关走自定义 provider + openai-completions;
        // skipBootstrap 跳过首轮身份仪式,否则 agent 会先问 "Who am I"。
        // workspace 钉沙箱工作目录,文件工具写到 eval 可见的路径。
        const openclawConfig = {
          agents: {
            defaults: {
              skipBootstrap: true,
              workspace: sb.workdir,
            },
          },
          models: {
            mode: "merge",
            providers: {
              [COMPAT_PROVIDER]: {
                baseUrl,
                apiKey: resolveApiKey(config),
                api: "openai-completions",
                models: [
                  { id: "gpt-5.6-luna", name: "gpt-5.6-luna" },
                  { id: "gpt-5.4-mini", name: "gpt-5.4-mini" },
                  { id: "gpt-5.4", name: "gpt-5.4" },
                ],
              },
            },
          },
        };
        await shared.writeFile(sb, "~/.openclaw/openclaw.json", JSON.stringify(openclawConfig, null, 2));
        // 预置最小身份文件,避免缺 IDENTITY 时仍触发仪式文案。
        await shared.writeFile(
          sb,
          `${sb.workdir}/IDENTITY.md`,
          "# Identity\n\nName: niceeval\nEmoji: ✓\n",
        );
        await shared.writeFile(
          sb,
          `${sb.workdir}/USER.md`,
          "# User\n\nEval harness operator.\n",
        );
        await shared.writeFile(
          sb,
          `${sb.workdir}/SOUL.md`,
          "# Soul\n\nExecute the user's task directly. Do not ask who you are.\n",
        );
      }

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
        ctx.reportSetup(manifest);
      }
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      // 会话契约:新会话线显式发新 session id(隔离);后续轮 resume 记录的 id。
      const sessionId = ctx.session.id ?? `niceeval-${sb.sandboxId}-${randomUUID().slice(0, 8)}`;
      ctx.session.capture(sessionId);

      const baseUrl = resolveBaseUrl(config);
      const args = ["agent", "--local", "--session-id", sessionId, "--message", input.text, "--json"];
      const model = resolveModelFlag(ctx.model, Boolean(baseUrl));
      if (model) args.push("--model", model);

      const apiKey = resolveApiKey(config);
      const env: globalThis.Record<string, string> = {
        OPENCLAW_API_KEY: apiKey,
        ANTHROPIC_API_KEY: apiKey,
        OPENAI_API_KEY: apiKey,
        ...ctx.telemetry?.env,
      };
      if (baseUrl) {
        env.OPENCLAW_BASE_URL = baseUrl;
        env.OPENAI_BASE_URL = baseUrl;
      }

      const res = await sb.runCommand("openclaw", args, { env, stream: true });

      const runJson = parseOpenClawRunJson(res.stdout);
      // 封包若带回服务端分配的 session key,后续轮以它为准(capture first-writer-wins,
      // 首轮已用自发 id 落地时不覆盖)。
      ctx.session.capture(runJson.sessionId);

      // 完整工具轨迹的唯一来源:session transcript。
      // 优先读封包给出的 sessionFile(精确);否则在 agents 目录取最新 *.jsonl,
      // 但排除同目录旁路产物 *.trajectory.jsonl(mtime 常更新、却不是消息轨——
      // 误读会导致 events 为空、整轮 coverage 降成 unavailable)。
      let raw: string | undefined;
      if (runJson.sessionFile) {
        try {
          raw = await sb.readFile(runJson.sessionFile);
        } catch {
          raw = undefined;
        }
      }
      if (raw === undefined) {
        raw = await shared.captureLatestJsonl(sb, "~/.openclaw/agents", {
          excludeName: /\.trajectory\.jsonl$/i,
        });
      }
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

      // 用量:transcript 逐消息累加优先;transcript 没报时用封包摘要,都没有就是空对象。
      const usage =
        (parsed.usage.inputTokens ?? 0) > 0 || (parsed.usage.outputTokens ?? 0) > 0
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
