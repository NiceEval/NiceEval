/** Coding-agent CLI versions used by runtime fallback installs and official sandbox recipes. */
export const DEFAULT_CODEX_CLI_VERSION = "0.144.1";
export const DEFAULT_CLAUDE_CODE_CLI_VERSION = "2.1.207";

/**
 * bub release that the pinned NiceEval recipe commit descends from.
 *
 * Bub 装的是一个不可变 fork commit（pin 见 `bub-install-spec.ts`），没有自己的 npm/PyPI 版本号；
 * 官方基线制品的版本位取该 commit 承接的上游 release。换 pin 时同批核对这个值，并 bump 下面的配方修订号。
 */
export const DEFAULT_BUB_VERSION = "0.3.9";

/** 有官方公共基线制品（E2B template + Docker image）的内置 coding agent。 */
export type CodingAgentBaseline = "claude-code" | "codex" | "bub";

/** 每个官方基线制品里装的那个 Agent 的版本——制品版本号的版本位。 */
export const AGENT_BASELINE_VERSION: Record<CodingAgentBaseline, string> = {
  "claude-code": DEFAULT_CLAUDE_CODE_CLI_VERSION,
  codex: DEFAULT_CODEX_CLI_VERSION,
  bub: DEFAULT_BUB_VERSION,
};

/**
 * NiceEval 基线配方自身的修订号——制品版本号的 `-r` 位。
 *
 * Agent 版本没变、配方变了（Node 工具契约、PATH 规范化、换 pin 的 commit、插件集合）就 +1；
 * Agent 版本一变归 1。已发布的 tag 不可原地覆盖，配方变更必须在版本里有位置表达。
 * 一个 Agent 的 E2B 与 Docker 制品共用这个号：一个版本号 = 一套基线配方，两侧同步重建。
 */
export const AGENT_BASELINE_RECIPE_REVISION: Record<CodingAgentBaseline, number> = {
  "claude-code": 2,
  codex: 2,
  bub: 2,
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
