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
import { shellQuote } from "../sandbox/shell.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import {
  parseOpenCodeTranscript,
  sessionIdFromOpenCodeTranscript,
  extractOpenCodeJsonl,
} from "../o11y/parsers/opencode.ts";
import { DEFAULT_OPENCODE_CLI_VERSION, AGENT_BASELINE_RECIPE_REVISION } from "./coding-cli-versions.ts";
import { createNpmCliInstaller } from "./npm-staged.ts";
import type { Agent, AgentSetupManifest, Sandbox, SkillSpec, StreamEvent } from "../types.ts";
import { makeSendFailure, sendAcceptanceFromEvents } from "../context/send-failures.ts";

// OpenCode sandbox adapter。驱动:`opencode run --format json --auto`;
// 行为轨优先 stdout JSONL,不足时 `opencode export <sessionID>`。
// 契约见 docs/feature/adapters/sdk/opencode/README.md。

const SKILL_DIR = ".agents/skills";
/** 自定义 OpenAI 兼容网关在 opencode.json 里的 provider id。 */
const COMPAT_PROVIDER = "compat";

/**
 * OpenCode 的 native skill registry 需要 YAML frontmatter 才会把 SKILL.md 广播给
 * `skill` 工具。共享 SkillSpec 同时服务不要求 frontmatter 的 coding agents，所以只在
 * OpenCode 沙箱内为缺失的元数据补一个由安装名派生的最小头；作者已有的 native header
 * 原样保留，仍由 OpenCode 自己校验。
 */
async function addOpenCodeSkillFrontmatter(sb: Sandbox, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const path = `${SKILL_DIR}/${name}/SKILL.md`;
    const quotedPath = shellQuote(path);
    const header = [
      "---",
      `name: ${JSON.stringify(name)}`,
      `description: ${JSON.stringify(`NiceEval-installed skill ${name}`)}`,
      "---",
      "",
    ].join("\n");
    const result = await sb.runShell(
      [
        `if [ \"$(sed -n '1p' ${quotedPath})\" != \"---\" ]; then`,
        "  tmp=$(mktemp) || exit 1",
        "  cat > \"$tmp\" <<'NICEEVAL_OPENCODE_SKILL_HEADER'",
        header,
        "NICEEVAL_OPENCODE_SKILL_HEADER",
        `  cat ${quotedPath} >> \"$tmp\" && mv \"$tmp\" ${quotedPath} || { rm -f \"$tmp\"; exit 1; }`,
        "fi",
      ].join("\n"),
    );
    if (result.exitCode !== 0) {
      throw new Error(`OpenCode skill ${JSON.stringify(name)} could not receive native frontmatter.`);
    }
  }
}

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
  const { ensure, installer } = createNpmCliInstaller({
      identity: {
        agent: "opencode",
        version,
        revision: String(AGENT_BASELINE_RECIPE_REVISION.opencode),
      },
      packageName: "opencode-ai",
      bin: "opencode",
  });

  return defineSandboxAgent({
    name: "opencode",
    evidenceCoverage: completeEvidenceCoverage,
    spanMapper: mapGenericSpans,
    ensure,
    installers: [installer],

    tracing: {
      protocol: "http/protobuf",
      env: (endpoint) => ({
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
      }),
    },

    async setup(sb, ctx) {
      const baseUrl = resolveBaseUrl(config);
      const provider: globalThis.Record<string, unknown> = {};
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
        await addOpenCodeSkillFrontmatter(sb, installedSkillNames(manifest.skills));
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
      const baseUrl = resolveBaseUrl(config);
      const args = ["run", input.text, "--format", "json", "--auto"];
      const model = resolveModelFlag(ctx.model, Boolean(baseUrl));
      if (model) args.push("--model", model);
      if (ctx.session.id) args.push("--session", ctx.session.id);

      const apiKey = resolveApiKey(config);
      const env: globalThis.Record<string, string> = {
        OPENCODE_API_KEY: apiKey,
        OPENAI_API_KEY: apiKey,
        ANTHROPIC_API_KEY: apiKey,
        ...ctx.telemetry?.env,
      };
      if (baseUrl) {
        env.OPENCODE_BASE_URL = baseUrl;
        env.OPENAI_BASE_URL = baseUrl;
      }

      const opencodeBin = await shared.resolveAgentBin(sb, "opencode");
      const sensitiveValues = [apiKey];
      const res = await sb.runCommand(opencodeBin, args, { env, sensitiveValues, stream: true });
      let raw = extractOpenCodeJsonl(res.stdout) ?? extractOpenCodeJsonl(`${res.stdout}\n${res.stderr}`);
      let sessionId = sessionIdFromOpenCodeTranscript(raw) ?? sessionIdFromOpenCodeTranscript(res.stdout);
      if (sessionId) ctx.session.capture(sessionId);

      let parsed = parseOpenCodeTranscript(raw);
      // 仅当 stdout 既没有工具也没有助手文本时才 export 补读——纯对话轮
      // (session/recall) 的 text 事件已在 JSONL 里,再 export 会冲掉已解析事件。
      const hasActions = parsed.events.some((e) => e.type === "operation.started" && e.operation.kind === "tool");
      const hasMessages = parsed.events.some((e) => e.type === "message");
      if (!hasActions && !hasMessages && (sessionId ?? ctx.session.id)) {
        const sid = sessionId ?? ctx.session.id!;
        const exported = await sb.runCommand(opencodeBin, ["export", sid], { env, sensitiveValues });
        if (exported.exitCode === 0 && exported.stdout.trim()) {
          raw = exported.stdout;
          parsed = parseOpenCodeTranscript(raw);
          sessionId = sessionIdFromOpenCodeTranscript(raw) ?? sessionId;
          if (sessionId) ctx.session.capture(sessionId);
        }
      }

      const events: StreamEvent[] = [...parsed.events];
      const hasErrorEvent = events.some((e) => e.type === "error");
      if (res.exitCode !== 0) {
        throw makeSendFailure({
          acceptance: sendAcceptanceFromEvents(events),
          message: shared.diagnoseFailure(res, parsed.events, raw),
          events,
          usage: parsed.usage,
          process: res,
        });
      }
      return {
        events,
        usage: parsed.usage,
        status: hasErrorEvent ? "failed" : "completed",
      };
    },
  });
}

export default openCodeAgent();
