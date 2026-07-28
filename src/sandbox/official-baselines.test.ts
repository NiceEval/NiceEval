// cases: docs/engineering/testing/unit/sandbox.md
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  AGENT_BASELINE_RECIPE_REVISION,
  AGENT_BASELINE_VERSION,
  DEFAULT_BUB_VERSION,
  DEFAULT_CLAUDE_CODE_CLI_VERSION,
  DEFAULT_CODEX_CLI_VERSION,
  DEFAULT_HERMES_CLI_VERSION,
  DEFAULT_OPENCLAW_CLI_VERSION,
  DEFAULT_OPENCODE_CLI_VERSION,
  type CodingAgentBaseline,
  agentBaselineVersionTag,
} from "../agents/coding-cli-versions.ts";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_REQUIREMENT,
  bubInstallHash,
  bubRequirement,
} from "../agents/bub-install-spec.ts";
import {
  type E2BCodingAgent,
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
  NICEEVAL_HERMES_DOCKER_IMAGE,
  NICEEVAL_OPENCLAW_DOCKER_IMAGE,
  NICEEVAL_OPENCODE_DOCKER_IMAGE,
} from "./docker-agent-image.ts";

const DOCKER_AGENTS = [
  "claude-code",
  "codex",
  "bub",
  "opencode",
  "hermes",
  "openclaw",
] as const satisfies readonly CodingAgentBaseline[];

const E2B_AGENTS = ["claude-code", "codex", "bub"] as const satisfies readonly E2BCodingAgent[];

const e2bTemplates: globalThis.Record<E2BCodingAgent, string> = {
  "claude-code": NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE,
  codex: NICEEVAL_CODEX_E2B_TEMPLATE,
  bub: NICEEVAL_BUB_E2B_TEMPLATE,
};

const dockerImages: globalThis.Record<CodingAgentBaseline, string> = {
  "claude-code": NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE,
  codex: NICEEVAL_CODEX_DOCKER_IMAGE,
  bub: NICEEVAL_BUB_DOCKER_IMAGE,
  opencode: NICEEVAL_OPENCODE_DOCKER_IMAGE,
  hermes: NICEEVAL_HERMES_DOCKER_IMAGE,
  openclaw: NICEEVAL_OPENCLAW_DOCKER_IMAGE,
};

interface PublishedTemplate {
  name: string;
  versionTag: string;
  agentVersion: string;
  installMarker?: string;
  templateId: string;
  buildId: string;
  /** 源码配方已前进到这个 tag、制品尚未发布时填;值必须就是配方派生出的 tag。 */
  supersededBy?: string;
}

const ledger = JSON.parse(
  await readFile(new URL("../../sandbox/e2b/published.json", import.meta.url), "utf8"),
) as { templates: globalThis.Record<E2BCodingAgent, PublishedTemplate> };

const dockerfile = await readFile(
  new URL("../../sandbox/docker/Dockerfile", import.meta.url),
  "utf8",
);

describe("official coding-agent baselines", () => {
  it.each(DOCKER_AGENTS)("versions the %s Docker baseline by the agent it ships, not by niceeval", (agent) => {
    // 版本位是被装的那个 Agent 的版本;-r 位是 NiceEval 配方自己的修订号。
    expect(agentBaselineVersionTag(agent)).toBe(
      `${AGENT_BASELINE_VERSION[agent]}-r${AGENT_BASELINE_RECIPE_REVISION[agent]}`,
    );
    expect(dockerImages[agent]).toBe(
      `${NICEEVAL_DOCKER_IMAGE_NAME[agent]}:${agentBaselineVersionTag(agent)}`,
    );
    // 接受 semver(`0.144.1-r2`)与 OpenClaw calver(`2026.7.1-2-r1`)。
    expect(agentBaselineVersionTag(agent)).toMatch(/^\d+(\.\d+)+(?:-\d+)?-r\d+$/);
  });

  it.each(E2B_AGENTS)("keeps the %s E2B build tag on the same recipe version as Docker", (agent) => {
    // 同一个 Agent 的两份制品共用一个版本号:一个版本号 = 一套基线配方。
    expect(e2bBaselineBuildTag(agent)).toBe(agentBaselineVersionTag(agent));
  });

  it("takes the version position from the same constants the runtime fallback installs", () => {
    expect(AGENT_BASELINE_VERSION).toEqual({
      "claude-code": DEFAULT_CLAUDE_CODE_CLI_VERSION,
      codex: DEFAULT_CODEX_CLI_VERSION,
      bub: DEFAULT_BUB_VERSION,
      opencode: DEFAULT_OPENCODE_CLI_VERSION,
      hermes: DEFAULT_HERMES_CLI_VERSION,
      openclaw: DEFAULT_OPENCLAW_CLI_VERSION,
    });
  });

  it.each(E2B_AGENTS)("points the exported %s E2B ref at a published template", (agent) => {
    const published = ledger.templates[agent];

    // 具名常量只能指向台账里真实存在的制品:发布是维护者手动动作,常量不能先跑到发布前面。
    expect(published.name).toBe(NICEEVAL_E2B_TEMPLATE_NAME[agent]);
    expect(e2bTemplates[agent]).toBe(`${published.name}:${published.versionTag}`);
    // 台账记的是那份制品里 Agent 的版本。源码把版本位往前推却没发布,只有一条合法出路:
    // 在台账里写下待发布的 tag(supersededBy)。默不作声地分叉不行——那正是「常量指着装了
    // 旧 Agent 的制品」而全绿的形态。
    if (published.supersededBy === undefined) {
      expect(published.agentVersion).toBe(AGENT_BASELINE_VERSION[agent]);
    } else {
      expect(published.supersededBy).toBe(agentBaselineVersionTag(agent));
    }
  });

  it("keeps the published Bub template's install fingerprint in sync with the recipe", () => {
    const published = ledger.templates.bub;

    // 换 pin 必然换指纹:预装环境的 marker 对不上时 Adapter 回退完整安装,所以旧制品仍可用,
    // 但台账必须承认它已被取代。
    if (published.supersededBy === undefined) {
      expect(published.installMarker).toBe(bubInstallHash([]));
    } else {
      expect(published.installMarker).not.toBe(bubInstallHash([]));
    }
  });

  it("keeps the Dockerfile's pinned versions in sync with the source constants", () => {
    // Dockerfile 不能 import TypeScript,漂移只在真实构建时暴露,所以逐个比对。
    expect(dockerfile).toContain(`ARG CODEX_VERSION=${DEFAULT_CODEX_CLI_VERSION}`);
    expect(dockerfile).toContain(`ARG CLAUDE_CODE_VERSION=${DEFAULT_CLAUDE_CODE_CLI_VERSION}`);
    expect(dockerfile).toContain(`ARG OPENCODE_VERSION=${DEFAULT_OPENCODE_CLI_VERSION}`);
    expect(dockerfile).toContain(`ARG OPENCLAW_VERSION=${DEFAULT_OPENCLAW_CLI_VERSION}`);
    expect(dockerfile).toContain(`ARG HERMES_VERSION=${DEFAULT_HERMES_CLI_VERSION}`);
    expect(dockerfile).toContain(DEFAULT_BUB_OTEL_PLUGIN.replace(/^git\+/, ""));
    expect(dockerfile).toContain(`'${bubInstallHash([])}' > $HOME/${BUB_INSTALL_MARKER}`);
  });

  it("puts both Bub pins into the install fingerprint", () => {
    const baseline = bubInstallHash([]);

    // 预装环境靠 marker 命中。版本或插件换了指纹却不变,就会在配方已变时继续命中旧环境,
    // 装到上一代 Bub 而全程无声。
    expect(bubInstallHash([], bubRequirement("0.3.9"))).not.toBe(baseline);
    expect(bubInstallHash([], DEFAULT_BUB_REQUIREMENT, `${DEFAULT_BUB_OTEL_PLUGIN}x`)).not.toBe(baseline);
    expect(bubRequirement("0.3.9")).toBe("bub==0.3.9");
  });

  it("keeps the Docker bub override file in sync with the pinned recipe", async () => {
    const override = await readFile(
      new URL("../../sandbox/docker/bub-override.txt", import.meta.url),
      "utf8",
    );

    // 这份 override 不是遗留物:插件所在 workspace 把 bub 声明成 git 依赖,少了它构建会拉
    // Bub 主干,镜像里的版本随构建时间漂移。
    expect(override.trim()).toBe(DEFAULT_BUB_REQUIREMENT);
  });
});
