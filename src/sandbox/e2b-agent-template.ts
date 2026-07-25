import { Template, type TemplateBuilder } from "e2b";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_REQUIREMENT,
  bubInstallHash,
  normalizeBubPackages,
} from "../agents/bub-install-spec.ts";
import {
  DEFAULT_CLAUDE_CODE_CLI_VERSION,
  DEFAULT_CODEX_CLI_VERSION,
  agentBaselineVersionTag,
} from "../agents/coding-cli-versions.ts";

/**
 * 已发布（或即将发布进台账）的 E2B 公共基线 Agent。
 *
 * 是 `CodingAgentBaseline` 的子集：OpenCode / Hermes / OpenClaw 只有 Docker 公共镜像，
 * E2B 模板尚未进 `sandbox/e2b/published.json`，不能提前导出指向空制品的常量。
 */
export type E2BCodingAgent = "claude-code" | "codex" | "bub";

export interface E2BCodingAgentTemplateOptions {
  /** Extra packages installed in Bub's uv tool environment and included in its compatibility marker. */
  bubPythonPackages?: readonly string[];
}

/** Provider-owned template aliases. Bub is built from NiceEval's pinned recipe. */
export const E2B_OFFICIAL_AGENT_TEMPLATES = {
  "claude-code": "claude",
  codex: "codex",
} as const;

/** NiceEval 公共 E2B baseline 所在的 Team namespace;跨 Team 引用必须带它。 */
export const NICEEVAL_E2B_TEAM = "correctroads-default-team";

/** 每个 Agent 的公共 E2B template 名字（不含 tag）。 */
export const NICEEVAL_E2B_TEMPLATE_NAME: Record<E2BCodingAgent, string> = {
  "claude-code": `${NICEEVAL_E2B_TEAM}/niceeval-claude-code`,
  codex: `${NICEEVAL_E2B_TEAM}/niceeval-codex`,
  bub: `${NICEEVAL_E2B_TEAM}/niceeval-bub`,
};

/**
 * 各 Agent 当前已发布并完成启动校验的公共 template tag。
 *
 * E2B 的发布是维护者手动动作（需要 `e2b auth login`），所以这里记的是**已发布事实**，
 * 不是源码配方派生值：构建脚本按 `agentBaselineVersionTag()` 打 tag，发布并真机验证后，
 * 同一批改动更新这张表与 `sandbox/e2b/published.json`。两者与源码版本常量的一致性由
 * `e2b-agent-template.test.ts` 守护——版本常量走在发布前面时测试红，常量不会先指向不存在的制品。
 */
const PUBLISHED_E2B_BASELINE_TAG: Record<E2BCodingAgent, string> = {
  "claude-code": "v0.6.1",
  codex: "v0.6.1",
  bub: "v0.6.1",
};

/**
 * NiceEval 官方公共 E2B baseline：每个值已经是完整、版本钉死、跨 Team 的 template ref。
 * 直接交给 `e2bSandbox({ template })`，或交给 E2B `Template().fromTemplate(...)` 继续派生。
 */
export const NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE =
  `${NICEEVAL_E2B_TEMPLATE_NAME["claude-code"]}:${PUBLISHED_E2B_BASELINE_TAG["claude-code"]}`;
export const NICEEVAL_CODEX_E2B_TEMPLATE =
  `${NICEEVAL_E2B_TEMPLATE_NAME.codex}:${PUBLISHED_E2B_BASELINE_TAG.codex}`;
export const NICEEVAL_BUB_E2B_TEMPLATE =
  `${NICEEVAL_E2B_TEMPLATE_NAME.bub}:${PUBLISHED_E2B_BASELINE_TAG.bub}`;

/**
 * Build tag for the next official E2B baseline of this agent: `<agent version>-r<recipe revision>`.
 *
 * 构建脚本用它打 tag,而不是用 niceeval 自己的 release——制品的版本位是它装的那个 Agent 的版本。
 */
export function e2bBaselineBuildTag(agent: E2BCodingAgent): string {
  return agentBaselineVersionTag(agent);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** E2B 沙箱的运行用户:agent 与 eval 的命令都以它执行,契约按它的视角定义。 */
const E2B_RUN_USER = "user";

/**
 * NiceEval 三份 E2B baseline 共同的 Node 工具前缀:运行用户的 npm global prefix、
 * 全局 bin 与全局 module 目录都收敛到这里。
 *
 * E2B 官方 `claude` 与 `codex` 起点把 Node 装在不同前缀下(`/usr` 与 `/usr/local`),
 * 默认 npm prefix 随之不同,只有后者对运行用户可写。不规范化的话,同一条 eval 的
 * `npm install -g` 会只因换 Agent 就整片 EACCES,而 Agent CLI 自检仍然通过。
 */
export const E2B_NODE_TOOL_PREFIX = "/usr/local";

const NODE_TOOL_BIN = `${E2B_NODE_TOOL_PREFIX}/bin`;
const NODE_TOOL_MODULES = `${E2B_NODE_TOOL_PREFIX}/lib/node_modules`;

/**
 * 横切在三条 Agent 配方之上的 Node 工具契约:准备运行用户可写的全局目录,并把它的
 * npm prefix 写进 user 级 npmrc(user config 优先级高于 builtin/global,不依赖登录 shell)。
 */
function withNodeToolContract(template: TemplateBuilder): TemplateBuilder {
  return template
    .runCmd(
      `mkdir -p ${NODE_TOOL_BIN} ${NODE_TOOL_MODULES} && chown ${E2B_RUN_USER} ${NODE_TOOL_BIN} ${NODE_TOOL_MODULES}`,
      { user: "root" },
    )
    .runCmd(`npm config set prefix ${E2B_NODE_TOOL_PREFIX}`, { user: E2B_RUN_USER });
}

/**
 * Assert the shared Node tooling contract inside a template build, as the sandbox run user.
 *
 * 校验 npm global prefix、`PATH` 与两个全局目录的写权限。任一项漂移时 build 在写入 registry
 * 前失败,不会发布一份「Agent CLI 能启动、但 `npm install -g` 必挂」的模板。构建脚本应在
 * 全部安装步骤之后链这一步。
 */
export function verifyE2BNodeToolContract(template: TemplateBuilder): TemplateBuilder {
  return template.runCmd(
    [
      `test "$(npm config get prefix)" = "${E2B_NODE_TOOL_PREFIX}" || { echo "npm global prefix is $(npm config get prefix), expected ${E2B_NODE_TOOL_PREFIX}" >&2; exit 1; }`,
      `case ":$PATH:" in *":${NODE_TOOL_BIN}:"*) ;; *) echo "${NODE_TOOL_BIN} is missing from PATH: $PATH" >&2; exit 1 ;; esac`,
      `test -w ${NODE_TOOL_BIN} || { echo "${NODE_TOOL_BIN} is not writable by $(id -un)" >&2; exit 1; }`,
      `test -w ${NODE_TOOL_MODULES} || { echo "${NODE_TOOL_MODULES} is not writable by $(id -un)" >&2; exit 1; }`,
    ],
    { user: E2B_RUN_USER },
  );
}

/**
 * Start an extensible E2B template for a coding agent.
 *
 * Claude Code and Codex extend E2B's official templates. Bub uses NiceEval's
 * immutable install recipe because E2B does not currently publish a Bub base.
 * Callers can chain normal E2B TemplateBuilder operations before building.
 *
 * 三种 agent 的产物共享同一份 Node 工具契约:运行用户的 npm global prefix 是
 * `/usr/local`,`/usr/local/bin` 在 PATH 中,该前缀下的 bin 与 module 目录对它可写。
 * 因此叠加全局 Node 工具用普通 `npm install -g <pkg>` 即可,不按 agent 分支。
 */
export function e2bCodingAgentTemplate(
  agent: E2BCodingAgent,
  options: E2BCodingAgentTemplateOptions = {},
): TemplateBuilder {
  if (agent === "claude-code" || agent === "codex") {
    if (options.bubPythonPackages?.length) {
      throw new Error("bubPythonPackages can only be used with the Bub E2B template");
    }
    const template = withNodeToolContract(Template().fromTemplate(E2B_OFFICIAL_AGENT_TEMPLATES[agent]));
    if (agent === "claude-code") {
      // E2B's official template puts a native Claude binary first in the user PATH; installing
      // npm as root would leave that older binary shadowing /usr/local/bin/claude.
      return template.runCmd(
        `curl -fsSL https://claude.ai/install.sh | bash -s ${DEFAULT_CLAUDE_CODE_CLI_VERSION}`,
        { user: E2B_RUN_USER },
      );
    }
    return template.runCmd(`npm install -g @openai/codex@${DEFAULT_CODEX_CLI_VERSION}`, { user: "root" });
  }

  const packages = normalizeBubPackages(options.bubPythonPackages ?? []);
  const installHash = bubInstallHash(packages);
  const withPackages = packages.map((value) => ` --with ${shellQuote(value)}`).join("");
  const marker = `/home/user/${BUB_INSTALL_MARKER}`;
  const overrideFile = "/tmp/bub-override.txt";
  return withNodeToolContract(Template().fromBaseImage())
    .runCmd("curl -LsSf https://astral.sh/uv/install.sh | sh", { user: E2B_RUN_USER })
    .runCmd(
      [
        // override 把 `bub` 钉成一个 PyPI 版本:OTel 插件所在 workspace 把 bub 声明成 git
        // 依赖,不覆盖的话构建会拉到 Bub 主干,模板里装的版本随构建时间漂移。
        `printf '%s\\n' ${shellQuote(DEFAULT_BUB_REQUIREMENT)} > ${overrideFile}`,
        `$HOME/.local/bin/uv tool install --python 3.12 --prerelease allow bub --overrides ${overrideFile} --with ${shellQuote(DEFAULT_BUB_OTEL_PLUGIN)}${withPackages}`,
        `mkdir -p $(dirname ${marker}) && printf '%s' ${shellQuote(installHash)} > ${marker}`,
      ],
      { user: E2B_RUN_USER },
    );
}
