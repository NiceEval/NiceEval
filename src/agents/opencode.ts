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
import { mapGenericSpans } from "../o11y/otlp/canonical.ts";
import { completeCoverage } from "../scoring/coverage.ts";
import {
  parseOpenCodeTranscript,
  sessionIdFromOpenCodeTranscript,
  extractOpenCodeJsonl,
} from "../o11y/parsers/opencode.ts";
import { DEFAULT_OPENCODE_CLI_VERSION } from "./coding-cli-versions.ts";
import type { Agent, AgentSetupManifest, SkillSpec, StreamEvent } from "../types.ts";

// OpenCode sandbox adapter。驱动:`opencode run --format json --auto`;
// 行为轨优先 stdout JSONL,不足时 `opencode export <sessionID>`。
// 契约见 docs/feature/adapters/sdk/opencode/README.md。

const SKILL_DIR = ".agents/skills";
/** 自定义 OpenAI 兼容网关在 opencode.json 里的 provider id。 */
const COMPAT_PROVIDER = "compat";

export interface OpenCodeConfig {
  /** 模型 API key。省略时读 OPENCODE_API_KEY,再回落 ANTHROPIC_API_KEY。 */
  apiKey?: string;
  /** OpenAI 兼容端点。省略时读 OPENCODE_BASE_URL。 */
  baseUrl?: string;
  /** 钉 npm `opencode-ai` 版本;省略时用 NiceEval 默认 pin。 */
  version?: string;
  /** 装进沙箱的 Skill,落在 `.agents/skills/<name>/`。 */
  skills?: SkillSpec[];
}

function resolveApiKey(config?: OpenCodeConfig): string {
  return config?.apiKey ?? getEnv("OPENCODE_API_KEY") ?? requireEnv("ANTHROPIC_API_KEY");
}

function resolveBaseUrl(config?: OpenCodeConfig): string | undefined {
  return config?.baseUrl ?? getEnv("OPENCODE_BASE_URL");
}

/** experiment.model → `--model`。裸模型名在自定义网关下补成 `compat/<model>`。 */
function resolveModelFlag(model: string | undefined, hasCompatBase: boolean): string | undefined {
  if (!model) return undefined;
  if (model.includes("/")) return model;
  return hasCompatBase ? `${COMPAT_PROVIDER}/${model}` : model;
}

/**
 * OpenCode 的内置 sandbox Agent 工厂。
 */
export function openCodeAgent(config?: OpenCodeConfig): Agent {
  const version = config?.version ?? DEFAULT_OPENCODE_CLI_VERSION;

  return defineSandboxAgent({
    name: "opencode",
    coverage: completeCoverage,
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
      await sb.runShell(
        `command -v opencode >/dev/null 2>&1 || npm install -g opencode-ai@${version}`,
      );

      const baseUrl = resolveBaseUrl(config);
      const provider: Record<string, unknown> = {};
      if (baseUrl) {
        // OpenAI 兼容网关必须走 openai-compatible npm 包 + 显式 models 表,
        // 否则 OpenCode 不会把自定义 baseURL 接到请求上。
        provider[COMPAT_PROVIDER] = {
          npm: "@ai-sdk/openai-compatible",
          name: "OpenAI-compatible",
          options: {
            apiKey: "{env:OPENCODE_API_KEY}",
            baseURL: baseUrl,
          },
          models: {
            // 允许任意 experiment.model;具体 id 由 --model compat/<id> 选择。
            "gpt-5.6-luna": { name: "gpt-5.6-luna" },
            "gpt-5.4-mini": { name: "gpt-5.4-mini" },
            "gpt-5.4": { name: "gpt-5.4" },
            "gpt-4.1-mini": { name: "gpt-4.1-mini" },
            "gpt-4o-mini": { name: "gpt-4o-mini" },
          },
        };
      }
      const opencodeConfig = {
        $schema: "https://opencode.ai/config.json",
        ...(Object.keys(provider).length ? { provider } : {}),
        permission: {
          write: "allow",
          edit: "allow",
          bash: "allow",
          read: "allow",
        },
      };
      await shared.writeFile(sb, "opencode.json", JSON.stringify(opencodeConfig, null, 2));

      const manifest: AgentSetupManifest = { skills: [] };
      if (config?.skills?.length) {
        manifest.skills = await installSkills(sb, config.skills, { dir: SKILL_DIR });
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
      const baseUrl = resolveBaseUrl(config);
      const args = ["run", input.text, "--format", "json", "--auto"];
      const model = resolveModelFlag(ctx.model, Boolean(baseUrl));
      if (model) args.push("--model", model);
      if (ctx.session.id) args.push("--session", ctx.session.id);

      const apiKey = resolveApiKey(config);
      const env: Record<string, string> = {
        OPENCODE_API_KEY: apiKey,
        OPENAI_API_KEY: apiKey,
        ANTHROPIC_API_KEY: apiKey,
        ...ctx.telemetry?.env,
      };
      if (baseUrl) {
        env.OPENCODE_BASE_URL = baseUrl;
        env.OPENAI_BASE_URL = baseUrl;
      }

      const res = await sb.runCommand("opencode", args, { env, stream: true });
      let raw = extractOpenCodeJsonl(res.stdout) ?? extractOpenCodeJsonl(`${res.stdout}\n${res.stderr}`);
      let sessionId = sessionIdFromOpenCodeTranscript(raw) ?? sessionIdFromOpenCodeTranscript(res.stdout);
      if (sessionId) ctx.session.capture(sessionId);

      let parsed = parseOpenCodeTranscript(raw);
      if (parsed.events.filter((e) => e.type === "action.called").length === 0 && (sessionId ?? ctx.session.id)) {
        const sid = sessionId ?? ctx.session.id!;
        const exported = await sb.runCommand("opencode", ["export", sid], { env });
        if (exported.exitCode === 0 && exported.stdout.trim()) {
          raw = exported.stdout;
          parsed = parseOpenCodeTranscript(raw);
          sessionId = sessionIdFromOpenCodeTranscript(raw) ?? sessionId;
          if (sessionId) ctx.session.capture(sessionId);
        }
      }

      const events: StreamEvent[] = [...parsed.events];
      const hasErrorEvent = events.some((e) => e.type === "error");
      const failed = res.exitCode !== 0 || hasErrorEvent;
      if (res.exitCode !== 0) {
        events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });
      }
      return {
        events,
        usage: parsed.usage,
        status: failed ? "failed" : "completed",
      };
    },
  });
}

export default openCodeAgent();
