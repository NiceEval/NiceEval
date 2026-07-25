// cases: docs/engineering/testing/unit/sandbox.md
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  AGENT_BASELINE_RECIPE_REVISION,
  AGENT_BASELINE_VERSION,
  DEFAULT_BUB_VERSION,
  DEFAULT_CLAUDE_CODE_CLI_VERSION,
  DEFAULT_CODEX_CLI_VERSION,
  type CodingAgentBaseline,
  agentBaselineVersionTag,
} from "../agents/coding-cli-versions.ts";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_OVERRIDE,
  bubInstallHash,
} from "../agents/bub-install-spec.ts";
import {
  NICEEVAL_BUB_E2B_TEMPLATE,
  NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE,
  NICEEVAL_CODEX_E2B_TEMPLATE,
  NICEEVAL_E2B_TEMPLATE_NAME,
  e2bBaselineBuildTag,
} from "./e2b-agent-template.ts";
import {
  NICEEVAL_BUB_DOCKER_IMAGE,
  NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE,
  NICEEVAL_CODEX_DOCKER_IMAGE,
  NICEEVAL_DOCKER_IMAGE_NAME,
} from "./docker-agent-image.ts";

const AGENTS = ["claude-code", "codex", "bub"] as const;

const e2bTemplates: Record<CodingAgentBaseline, string> = {
  "claude-code": NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE,
  codex: NICEEVAL_CODEX_E2B_TEMPLATE,
  bub: NICEEVAL_BUB_E2B_TEMPLATE,
};

const dockerImages: Record<CodingAgentBaseline, string> = {
  "claude-code": NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE,
  codex: NICEEVAL_CODEX_DOCKER_IMAGE,
  bub: NICEEVAL_BUB_DOCKER_IMAGE,
};

interface PublishedTemplate {
  name: string;
  versionTag: string;
  agentVersion: string;
  installMarker?: string;
  templateId: string;
  buildId: string;
}

const ledger = JSON.parse(
  await readFile(new URL("../../sandbox/e2b/published.json", import.meta.url), "utf8"),
) as { templates: Record<CodingAgentBaseline, PublishedTemplate> };

const dockerfile = await readFile(
  new URL("../../sandbox/docker/Dockerfile", import.meta.url),
  "utf8",
);

describe("official coding-agent baselines", () => {
  it.each(AGENTS)("versions the %s baseline by the agent it ships, not by niceeval", (agent) => {
    // 版本位是被装的那个 Agent 的版本;-r 位是 NiceEval 配方自己的修订号。
    expect(agentBaselineVersionTag(agent)).toBe(
      `${AGENT_BASELINE_VERSION[agent]}-r${AGENT_BASELINE_RECIPE_REVISION[agent]}`,
    );
    // 同一个 Agent 的两份制品共用一个版本号:一个版本号 = 一套基线配方。
    expect(dockerImages[agent]).toBe(
      `${NICEEVAL_DOCKER_IMAGE_NAME[agent]}:${agentBaselineVersionTag(agent)}`,
    );
    expect(e2bBaselineBuildTag(agent)).toBe(agentBaselineVersionTag(agent));
    expect(agentBaselineVersionTag(agent)).toMatch(/^\d+\.\d+\.\d+-r\d+$/);
  });

  it("takes the version position from the same constants the runtime fallback installs", () => {
    expect(AGENT_BASELINE_VERSION).toEqual({
      "claude-code": DEFAULT_CLAUDE_CODE_CLI_VERSION,
      codex: DEFAULT_CODEX_CLI_VERSION,
      bub: DEFAULT_BUB_VERSION,
    });
  });

  it.each(AGENTS)("points the exported %s E2B ref at a published template", (agent) => {
    const published = ledger.templates[agent];

    // 具名常量只能指向台账里真实存在的制品:发布是维护者手动动作,常量不能先跑到发布前面。
    expect(published.name).toBe(NICEEVAL_E2B_TEMPLATE_NAME[agent]);
    expect(e2bTemplates[agent]).toBe(`${published.name}:${published.versionTag}`);
    // 台账记的是那份制品里 Agent 的版本;与源码版本常量分叉说明该发新基线了。
    expect(published.agentVersion).toBe(AGENT_BASELINE_VERSION[agent]);
  });

  it("keeps the published Bub template's install fingerprint in sync with the recipe", () => {
    expect(ledger.templates.bub.installMarker).toBe(bubInstallHash([]));
  });

  it("keeps the Dockerfile's pinned versions in sync with the source constants", () => {
    // Dockerfile 不能 import TypeScript,漂移只在真实构建时暴露,所以逐个比对。
    expect(dockerfile).toContain(`ARG CODEX_VERSION=${DEFAULT_CODEX_CLI_VERSION}`);
    expect(dockerfile).toContain(`ARG CLAUDE_CODE_VERSION=${DEFAULT_CLAUDE_CODE_CLI_VERSION}`);
    expect(dockerfile).toContain(DEFAULT_BUB_OTEL_PLUGIN.replace(/^git\+/, ""));
    expect(dockerfile).toContain(`'${bubInstallHash([])}' > $HOME/${BUB_INSTALL_MARKER}`);
  });

  it("keeps the Docker bub override file in sync with the pinned recipe", async () => {
    const override = await readFile(
      new URL("../../sandbox/docker/bub-override.txt", import.meta.url),
      "utf8",
    );

    expect(override.trim()).toBe(DEFAULT_BUB_OVERRIDE);
  });
});
