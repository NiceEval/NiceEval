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

/** Public NiceEval baselines. Pin a release tag in CI; untagged names follow the current stable build. */
export const NICEEVAL_PUBLIC_E2B_TEMPLATES = {
  "claude-code": "correctroads-default-team/niceeval-claude-code",
  codex: "correctroads-default-team/niceeval-codex",
  bub: "correctroads-default-team/niceeval-bub",
} as const;

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
