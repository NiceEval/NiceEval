/** Coding-agent CLI versions used by runtime fallback installs and official sandbox recipes. */
export const DEFAULT_CODEX_CLI_VERSION = "0.144.1";
export const DEFAULT_CLAUDE_CODE_CLI_VERSION = "2.1.207";

/**
 * Bub release installed from PyPI by runtime fallback installs and official sandbox recipes.
 *
 * 换版本时同批核对 `bub-install-spec.ts` 的 OTel 插件 pin：插件与 Bub 的 tape 协议同代，
 * 配错代不会安装失败，而是时间轨静默为空。
 */
export const DEFAULT_BUB_VERSION = "0.4.0";

/** OpenCode CLI（npm `opencode-ai`）默认钉的版本。 */
export const DEFAULT_OPENCODE_CLI_VERSION = "1.18.5";

/** Hermes Agent（PyPI `hermes-agent`）默认钉的版本。 */
export const DEFAULT_HERMES_CLI_VERSION = "0.19.0";

/** OpenClaw CLI（npm `openclaw`）默认钉的版本。 */
export const DEFAULT_OPENCLAW_CLI_VERSION = "2026.7.1-2";

/**
 * 有官方公共基线制品的内置 coding agent。
 *
 * Docker 侧六家齐全；E2B 侧目前只发布 Claude Code / Codex / Bub
 *（见 `E2BCodingAgent`），其余 Agent 的 E2B 模板尚未进台账。
 */
export type CodingAgentBaseline =
  | "claude-code"
  | "codex"
  | "bub"
  | "opencode"
  | "hermes"
  | "openclaw";

/** 每个官方基线制品里装的那个 Agent 的版本——制品版本号的版本位。 */
export const AGENT_BASELINE_VERSION: globalThis.Record<CodingAgentBaseline, string> = {
  "claude-code": DEFAULT_CLAUDE_CODE_CLI_VERSION,
  codex: DEFAULT_CODEX_CLI_VERSION,
  bub: DEFAULT_BUB_VERSION,
  opencode: DEFAULT_OPENCODE_CLI_VERSION,
  hermes: DEFAULT_HERMES_CLI_VERSION,
  openclaw: DEFAULT_OPENCLAW_CLI_VERSION,
};

/**
 * NiceEval 基线配方自身的修订号——制品版本号的 `-r` 位。
 *
 * Agent 版本没变、配方变了（Node 工具契约、PATH 规范化、换 pin 的 commit、插件集合）就 +1；
 * Agent 版本一变归 1。已发布的 tag 不可原地覆盖，配方变更必须在版本里有位置表达。
 * 一个 Agent 的 E2B 与 Docker 制品共用这个号：一个版本号 = 一套基线配方，两侧同步重建。
 */
export const AGENT_BASELINE_RECIPE_REVISION: globalThis.Record<CodingAgentBaseline, number> = {
  "claude-code": 2,
  // r3: staged 安装改用自带运行时的原生平台包(不再要求沙箱里有 node / npm)
  codex: 3,
  bub: 1,
  opencode: 1,
  hermes: 1,
  openclaw: 1,
};

/**
 * 官方基线制品的版本 tag：`<Agent 版本>-r<配方修订>`，如 `0.144.1-r2`。
 *
 * niceeval 自身的版本不参与命名——库与制品内容无关，发版不该连带重建没变的制品，
 * 换 Agent 版本也不该等库发版。
 */
export function agentBaselineVersionTag(agent: CodingAgentBaseline): string {
  return `${AGENT_BASELINE_VERSION[agent]}-r${AGENT_BASELINE_RECIPE_REVISION[agent]}`;
}
