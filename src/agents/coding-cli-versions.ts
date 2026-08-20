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

/** Oh My Pi coding-agent CLI (npm) and its Bun runtime. */
export const DEFAULT_OMP_CLI_VERSION = "17.3.5";
export const DEFAULT_BUN_VERSION = "1.3.14";

/** DeepSeek Harness CLI (npm `@deepseek-ai/dsh`). */
export const DEFAULT_DEEPSEEK_HARNESS_CLI_VERSION = "0.1.0-rc.7";

/**
 * 有官方公共基线制品的 coding agent。
 *
 * Docker 侧八家齐全；E2B 侧目前只发布 Claude Code / Codex / Bub
 *（见 `E2BCodingAgent`），其余 Agent 的 E2B 模板尚未进台账。
 */
export type CodingAgentBaseline =
  | "claude-code"
  | "codex"
  | "bub"
  | "opencode"
  | "hermes"
  | "openclaw"
  | "omp"
  | "deepseek-harness";

/** 每个官方基线制品里装的那个 Agent 的版本——制品版本号的版本位。 */
export const AGENT_BASELINE_VERSION: globalThis.Record<CodingAgentBaseline, string> = {
  "claude-code": DEFAULT_CLAUDE_CODE_CLI_VERSION,
  codex: DEFAULT_CODEX_CLI_VERSION,
  bub: DEFAULT_BUB_VERSION,
  opencode: DEFAULT_OPENCODE_CLI_VERSION,
  hermes: DEFAULT_HERMES_CLI_VERSION,
  openclaw: DEFAULT_OPENCLAW_CLI_VERSION,
  omp: DEFAULT_OMP_CLI_VERSION,
  "deepseek-harness": DEFAULT_DEEPSEEK_HARNESS_CLI_VERSION,
};

/**
 * NiceEval 基线配方自身的修订号——制品版本号的 `-r` 位。
 *
 * Agent 版本没变、配方变了（Node 工具契约、PATH 规范化、换 pin 的 commit、插件集合）就 +1；
 * Agent 版本一变归 1。已发布的 tag 不可原地覆盖，配方变更必须在版本里有位置表达。
 * 一个 Agent 的 E2B 与 Docker 制品共用这个号：一个版本号 = 一套基线配方，两侧同步重建。
 */
// r4/r5(视 Agent 而定)未发布过镜像:补的「/usr/local/bin 与 /usr/local/lib/node_modules
// 对运行用户可写」(跨 provider 基线工具面第三条)并进这次未发布修订,不再额外 +1。
export const AGENT_BASELINE_RECIPE_REVISION: globalThis.Record<CodingAgentBaseline, number> = {
  // r3: Dockerfile 里 npm 全局装完后显式 `USER node`——运行时不再强加执行身份,
  // 改为沿用镜像自己声明的 USER,非 root 必须由配方自己声明(见 docs/feature/sandbox/library.md「执行身份」)
  // r4: 跨 provider 基线工具面统一——不预装 yarn 实体,补齐 python3,
  // 并补 /usr/local 对运行用户可写(docs/feature/sandbox/library/prebuilt-environments.md
  // 「跨 provider 基线工具面」)
  "claude-code": 4,
  // r3: staged 安装改用自带运行时的原生平台包(不再要求沙箱里有 node / npm)
  // r4: 同上「USER node」配方变更
  // r5: 同上「跨 provider 基线工具面统一」配方变更(含可写性)
  codex: 5,
  // r2: 跨 provider 基线工具面统一(同上,含可写性)
  bub: 2,
  // r2: 同上「USER node」配方变更
  // r3: 同上「跨 provider 基线工具面统一」配方变更(含可写性)
  opencode: 3,
  // r2: 跨 provider 基线工具面统一——本 target 原本单独装的 python3 现由 base 统一提供,
  // 配方内容变了但不预装 yarn 不改变行为(同上,含可写性)
  hermes: 2,
  // r2: 同上「USER node」配方变更
  // r3: 同上「跨 provider 基线工具面统一」配方变更(含可写性)
  openclaw: 3,
  omp: 1,
  "deepseek-harness": 1,
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
