import { Template, type TemplateBuilder } from "e2b";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_OVERRIDE,
  bubInstallHash,
  normalizeBubPackages,
} from "../agents/bub-install-spec.ts";
import {
  DEFAULT_CLAUDE_CODE_CLI_VERSION,
  DEFAULT_CODEX_CLI_VERSION,
} from "../agents/coding-cli-versions.ts";

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

/**
 * NiceEval 当前已发布并完成启动校验的公共 E2B template release。
 *
 * 这是公共模板 registry 的版本，不从源码 checkout 中可能滞后的 package.json 推导。
 * 发布一组新的 Claude Code / Codex / Bub template 并验证后，由 NiceEval 在这里统一 bump；
 * 下游不应再复制这条 release 知识。
 */
const NICEEVAL_E2B_TEMPLATE_RELEASE = "v0.6.1";

/**
 * NiceEval 官方公共 E2B baseline：每个值已经是完整、release-pinned、跨 Team template ref。
 * 直接交给 `e2bSandbox({ template })`，或交给 E2B `Template().fromTemplate(...)` 继续派生。
 */
export const NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE =
  `correctroads-default-team/niceeval-claude-code:${NICEEVAL_E2B_TEMPLATE_RELEASE}`;
export const NICEEVAL_CODEX_E2B_TEMPLATE =
  `correctroads-default-team/niceeval-codex:${NICEEVAL_E2B_TEMPLATE_RELEASE}`;
export const NICEEVAL_BUB_E2B_TEMPLATE =
  `correctroads-default-team/niceeval-bub:${NICEEVAL_E2B_TEMPLATE_RELEASE}`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Start an extensible E2B template for a coding agent.
 *
 * Claude Code and Codex extend E2B's official templates. Bub uses NiceEval's
 * immutable install recipe because E2B does not currently publish a Bub base.
 * Callers can chain normal E2B TemplateBuilder operations before building.
 */
export function e2bCodingAgentTemplate(
  agent: E2BCodingAgent,
  options: E2BCodingAgentTemplateOptions = {},
): TemplateBuilder {
  if (agent === "claude-code" || agent === "codex") {
    if (options.bubPythonPackages?.length) {
      throw new Error("bubPythonPackages can only be used with the Bub E2B template");
    }
    const template = Template().fromTemplate(E2B_OFFICIAL_AGENT_TEMPLATES[agent]);
    if (agent === "claude-code") {
      // E2B's official template puts a native Claude binary first in the user PATH; installing
      // npm as root would leave that older binary shadowing /usr/local/bin/claude.
      return template.runCmd(
        `curl -fsSL https://claude.ai/install.sh | bash -s ${DEFAULT_CLAUDE_CODE_CLI_VERSION}`,
        { user: "user" },
      );
    }
    return template.runCmd(`npm install -g @openai/codex@${DEFAULT_CODEX_CLI_VERSION}`, { user: "root" });
  }

  const packages = normalizeBubPackages(options.bubPythonPackages ?? []);
  const installHash = bubInstallHash(packages);
  const withPackages = packages.map((value) => ` --with ${shellQuote(value)}`).join("");
  const marker = `/home/user/${BUB_INSTALL_MARKER}`;
  const overrideFile = "/tmp/bub-override.txt";
  return Template()
    .fromBaseImage()
    .runCmd("curl -LsSf https://astral.sh/uv/install.sh | sh", { user: "user" })
    .runCmd(
      [
        `printf '%s\\n' ${shellQuote(DEFAULT_BUB_OVERRIDE)} > ${overrideFile}`,
        `$HOME/.local/bin/uv tool install --python 3.12 --prerelease allow bub --overrides ${overrideFile} --with ${shellQuote(DEFAULT_BUB_OTEL_PLUGIN)}${withPackages}`,
        `mkdir -p $(dirname ${marker}) && printf '%s' ${shellQuote(installHash)} > ${marker}`,
      ],
      { user: "user" },
    );
}
