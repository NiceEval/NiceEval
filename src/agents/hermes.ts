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
import { parseHermesTranscript, sessionIdFromHermesOutput } from "../o11y/parsers/hermes.ts";
import { DEFAULT_HERMES_CLI_VERSION } from "./coding-cli-versions.ts";
import { shellQuote } from "../sandbox/shell.ts";
import type { Agent, AgentSetupManifest, EvidenceCoverage, Sandbox, SkillSpec, StreamEvent } from "../types.ts";

// Hermes Agent sandbox adapter。驱动:`hermes chat -q … --yolo`;
// 行为轨优先 `hermes sessions export`,不足时 sqlite 读 messages。
// 契约见 docs/feature/adapters/sdk/hermes/README.md。

const SKILL_DIR = ".hermes/skills";

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

async function exportSession(sb: Sandbox, sessionId: string): Promise<string | undefined> {
  const outPath = `/tmp/niceeval-hermes-${sessionId}.jsonl`;
  const res = await sb.runCommand(
    "hermes",
    ["sessions", "export", outPath, "--session-id", sessionId],
  );
  if (res.exitCode !== 0) return undefined;
  try {
    return await sb.readFile(outPath);
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

  return defineSandboxAgent({
    name: "hermes",
    coverage: completeCoverage,
    spanMapper: mapGenericSpans,

    async setup(sb) {
      // 预装命中且能跑通 version 就跳过;否则 uv/pip 钉版本安装。
      await sb.runShell(
        [
          `if ! command -v hermes >/dev/null 2>&1; then`,
          `  if command -v uv >/dev/null 2>&1; then`,
          `    uv tool install hermes-agent==${version}`,
          `  else`,
          `    pip install --user hermes-agent==${version}`,
          `    export PATH="$HOME/.local/bin:$PATH"`,
          `  fi`,
          `fi`,
        ].join("\n"),
      );

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
      const args = ["chat", "-q", input.text, "--yolo"];
      if (ctx.model) args.push("--model", ctx.model);
      if (ctx.session.id) args.push("--resume", ctx.session.id);

      const apiKey = resolveApiKey(config);
      const env: Record<string, string> = {
        HERMES_API_KEY: apiKey,
        ANTHROPIC_API_KEY: apiKey,
        OPENROUTER_API_KEY: apiKey,
        OPENAI_API_KEY: apiKey,
        HERMES_YOLO_MODE: "1",
        ...ctx.telemetry?.env,
      };
      const baseUrl = config?.baseUrl ?? getEnv("HERMES_API_BASE");
      if (baseUrl) {
        env.HERMES_API_BASE = baseUrl;
        env.OPENAI_BASE_URL = baseUrl;
        env.ANTHROPIC_BASE_URL = baseUrl;
      }

      const res = await sb.runCommand("hermes", args, { env, stream: true });
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
        raw = await exportSession(sb, sessionId);
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
        events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });
      }

      return {
        events,
        usage: parsed.usage,
        status: res.exitCode === 0 ? "completed" : "failed",
        ...(turnCoverage ? { coverage: turnCoverage } : {}),
      };
    },
  });
}

export default hermesAgent();
