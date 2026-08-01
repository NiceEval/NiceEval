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
import { completeCoverage } from "../scoring/coverage.ts";
import { parseHermesTranscript, sessionIdFromHermesOutput } from "../o11y/parsers/hermes.ts";
import { DEFAULT_HERMES_CLI_VERSION } from "./coding-cli-versions.ts";
import { shellQuote } from "../sandbox/shell.ts";
import type { Agent, AgentSetupManifest, EvidenceCoverage, Sandbox, SkillSpec, StreamEvent } from "../types.ts";
import { makeSendFailure, sendAcceptanceFromEvents } from "../context/send-failures.ts";
import { defineSandboxCommand } from "../sandbox/commands.ts";

// Hermes Agent sandbox adapter。驱动:`hermes chat -q … --yolo`;
// 行为轨优先 `hermes sessions export`,不足时 sqlite 读 messages。
// 契约见 docs/feature/adapters/sdk/hermes/README.md。
//
// Docker 沙箱会覆盖 PATH(不含 $HOME/.local/bin),所以安装与调用一律走
// `$HOME/.local/bin/hermes`(同 bub 裁决),不依赖 command -v。

const SKILL_DIR = ".hermes/skills";
const UV = "$HOME/.local/bin/uv";
const HERMES = "$HOME/.local/bin/hermes";

export interface HermesConfig {
  /** 模型 API key。省略时读 HERMES_API_KEY → OPENROUTER_API_KEY → ANTHROPIC_API_KEY。 */
  apiKey?: string;
  /** OpenAI 兼容端点。省略时读 HERMES_API_BASE。 */
  baseUrl?: string;
  /** 钉 PyPI `hermes-agent` 版本;省略时用 NiceEval 默认 pin。 */
  version?: string;
  /** 装进沙箱的 Skill,落在 `~/.hermes/skills/<name>/`。 */
  skills?: SkillSpec[];
}

function resolveApiKey(config?: HermesConfig): string {
  return (
    config?.apiKey ??
    getEnv("HERMES_API_KEY") ??
    getEnv("OPENROUTER_API_KEY") ??
    requireEnv("ANTHROPIC_API_KEY")
  );
}

function resolveBaseUrl(config?: HermesConfig): string | undefined {
  return config?.baseUrl ?? getEnv("HERMES_API_BASE");
}

async function hermesShell(
  sb: Sandbox,
  args: string[],
  env: globalThis.Record<string, string>,
  opts?: { stream?: boolean },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // HERMES 变量本身不要 quote,以便 shell 展开 $HOME。
  const script = `${HERMES} ${args.map(shellQuote).join(" ")}`;
  return sb.runShell(script, { env, stream: opts?.stream });
}

async function exportSession(sb: Sandbox, sessionId: string, env: globalThis.Record<string, string>): Promise<string | undefined> {
  const outPath = `/tmp/niceeval-hermes-${sessionId}.jsonl`;
  const res = await hermesShell(sb, ["sessions", "export", outPath, "--session-id", sessionId], env);
  if (res.exitCode !== 0) return undefined;
  try {
    return await sb.readText(outPath);
  } catch {
    return undefined;
  }
}

async function dumpMessagesFromDb(sb: Sandbox, sessionId: string): Promise<string | undefined> {
  // 不引入宿主 sqlite3 依赖:在沙箱里用 python 读 state.db(Hermes 自带 Python 运行时)。
  const script = `
import json, sqlite3, os, sys
db = os.path.expanduser("~/.hermes/state.db")
if not os.path.exists(db):
    sys.exit(0)
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
sid = sys.argv[1]
sess = con.execute("SELECT * FROM sessions WHERE id = ?", (sid,)).fetchone()
if sess:
    print(json.dumps(dict(sess), default=str))
rows = con.execute(
    "SELECT role, content, tool_call_id, tool_calls, tool_name, reasoning, reasoning_content FROM messages WHERE session_id = ? ORDER BY timestamp, id",
    (sid,),
).fetchall()
for r in rows:
    print(json.dumps(dict(r), default=str))
`;
  const res = await sb.runShell(`python3 -c ${shellQuote(script)} ${shellQuote(sessionId)}`);
  if (res.exitCode !== 0 || !res.stdout.trim()) return undefined;
  return res.stdout;
}

/**
 * Hermes Agent 的内置 sandbox Agent 工厂。
 */
export function hermesAgent(config?: HermesConfig): Agent {
  const version = config?.version ?? DEFAULT_HERMES_CLI_VERSION;
  const identity = { agent: "hermes", version, revision: "1" } as const;
  const probe = defineSandboxCommand(
    { id: "niceeval.agent.probe.hermes", revision: identity.revision, inputs: identity },
    async (sandbox) => {
      await sandbox.runShellOrThrow(
        `test -x ${HERMES} && ${HERMES} --version 2>&1 | grep -F -- ${shellQuote(version)}`,
      );
    },
  );

  return defineSandboxAgent({
    name: "hermes",
    ensure: { identity, probe },
    installers: [{
      identity,
      installMode: "sandbox-network",
      install: async (sandbox) => {
        await sandbox.runShellOrThrow(`test -x ${UV} || (curl -LsSf https://astral.sh/uv/install.sh | sh)`);
        await sandbox.runShellOrThrow(`${UV} tool install hermes-agent==${version}`);
      },
    }],
    coverage: completeCoverage,
    spanMapper: mapGenericSpans,

    async setup(sb, ctx) {
      const baseUrl = resolveBaseUrl(config);
      if (baseUrl) {
        // OpenAI 兼容网关:写 custom provider + model.base_url;
        // secret 进 ~/.hermes/.env,不进 git 可见配置。
        const apiKey = resolveApiKey(config);
        const hermesConfig = [
          "model:",
          "  provider: custom",
          `  base_url: ${baseUrl}`,
          "custom_providers:",
          "  - name: compat",
          `    base_url: ${baseUrl}`,
          `    api_key: ${apiKey}`,
          "",
        ].join("\n");
        const hermesEnv = [
          `OPENAI_API_KEY=${apiKey}`,
          `OPENAI_BASE_URL=${baseUrl}`,
          "",
        ].join("\n");
        await shared.writeFile(sb, "~/.hermes/config.yaml", hermesConfig);
        await shared.writeFile(sb, "~/.hermes/.env", hermesEnv);
      }

      const manifest: AgentSetupManifest = { skills: [] };
      if (config?.skills?.length) {
        manifest.skills = await installSkills(sb, config.skills, { dir: SKILL_DIR });
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
      const args = ["chat", "-q", input.text, "--yolo", "-Q"];
      if (ctx.model) args.push("--model", ctx.model);
      if (baseUrl) args.push("--provider", "custom");
      if (ctx.session.id) args.push("--resume", ctx.session.id);

      const apiKey = resolveApiKey(config);
      const env: globalThis.Record<string, string> = {
        HERMES_API_KEY: apiKey,
        ANTHROPIC_API_KEY: apiKey,
        OPENROUTER_API_KEY: apiKey,
        OPENAI_API_KEY: apiKey,
        HERMES_YOLO_MODE: "1",
        ...ctx.telemetry?.env,
      };
      if (baseUrl) {
        env.HERMES_API_BASE = baseUrl;
        env.OPENAI_BASE_URL = baseUrl;
        env.ANTHROPIC_BASE_URL = baseUrl;
      }

      const res = await hermesShell(sb, args, env, { stream: true });
      let sessionId =
        sessionIdFromHermesOutput(res.stdout) ??
        sessionIdFromHermesOutput(res.stderr) ??
        ctx.session.id;

      // 没从输出抠到 id 时,取 state.db 里最新 cli session
      if (!sessionId) {
        const latest = await sb.runShell(
          `python3 -c 'import sqlite3,os;db=os.path.expanduser("~/.hermes/state.db");
import sys
if not os.path.exists(db): sys.exit(0)
c=sqlite3.connect(db)
r=c.execute("select id from sessions where source=\\"cli\\" order by started_at desc limit 1").fetchone()
print(r[0] if r else "")'`,
        );
        const id = latest.stdout.trim();
        if (id) sessionId = id;
      }
      if (sessionId) ctx.session.capture(sessionId);

      let raw: string | undefined;
      if (sessionId) {
        raw = await exportSession(sb, sessionId, env);
        if (!raw) raw = await dumpMessagesFromDb(sb, sessionId);
      }

      const parsed = parseHermesTranscript(raw);
      const events: StreamEvent[] = [...parsed.events];

      let turnCoverage: EvidenceCoverage | undefined;
      if (!raw || parsed.events.length === 0) {
        const reason = "hermes session export/state.db unavailable; tool trajectory missing";
        turnCoverage = {
          events: { status: "unavailable", reason },
          actions: { status: "unavailable", reason },
          usage: { status: "unavailable", reason },
        };
        ctx.log("hermes transcript unavailable: negative assertions are unreliable");
        const text = res.stdout.trim().split("\n").filter((l) => !l.startsWith("{")).slice(-8).join("\n");
        if (text) events.push({ type: "message", role: "assistant", text });
      }

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
        status: "completed",
        ...(turnCoverage ? { coverage: turnCoverage } : {}),
      };
    },
  });
}

export default hermesAgent();
