import {
  type CodingAgentBaseline,
  agentBaselineVersionTag,
} from "../agents/coding-cli-versions.ts";

/** 每个 Agent 的 NiceEval 公共 Docker Hub repository（不含 tag）。 */
export const NICEEVAL_DOCKER_IMAGE_NAME: globalThis.Record<CodingAgentBaseline, string> = {
  "claude-code": "niceeval/claude-code",
  codex: "niceeval/codex",
  bub: "niceeval/bub",
  opencode: "niceeval/opencode",
  hermes: "niceeval/hermes",
  openclaw: "niceeval/openclaw",
  omp: "niceeval/omp",
  "deepseek-harness": "niceeval/deepseek-harness",
};

/**
 * Fully pinned reference to a NiceEval official coding-agent Docker image.
 *
 * tag 就是[基线版本号](../agents/coding-cli-versions.ts)`<Agent 版本>-r<配方修订>`：
 * 镜像的配方与版本常量在同一个 commit 里，Docker 侧的发布由配方变更触发的 CI 完成，
 * 因此引用直接由版本常量派生，不另存一份易漂移的镜像 tag。
 */
export function niceevalDockerImage(agent: CodingAgentBaseline): string {
  return `${NICEEVAL_DOCKER_IMAGE_NAME[agent]}:${agentBaselineVersionTag(agent)}`;
}

/**
 * NiceEval 官方公共 Docker 镜像：每个值是完整、版本钉死的引用，直接交给
 * `dockerSandbox({ source: { type: "image", image } })`，
 * 或写进项目 Dockerfile 的 `FROM` 继续叠加依赖。
 */
export const NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE = niceevalDockerImage("claude-code");
export const NICEEVAL_CODEX_DOCKER_IMAGE = niceevalDockerImage("codex");
export const NICEEVAL_BUB_DOCKER_IMAGE = niceevalDockerImage("bub");
export const NICEEVAL_OPENCODE_DOCKER_IMAGE = niceevalDockerImage("opencode");
export const NICEEVAL_HERMES_DOCKER_IMAGE = niceevalDockerImage("hermes");
export const NICEEVAL_OPENCLAW_DOCKER_IMAGE = niceevalDockerImage("openclaw");
export const NICEEVAL_OMP_DOCKER_IMAGE = niceevalDockerImage("omp");
export const NICEEVAL_DEEPSEEK_HARNESS_DOCKER_IMAGE = niceevalDockerImage("deepseek-harness");
