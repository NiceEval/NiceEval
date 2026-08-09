import {
  defineSandboxCommand,
  dockerSandbox,
  NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE,
  registerSandboxContent,
} from "niceeval/sandbox";

const marketplace = registerSandboxContent(
  new URL("./fixtures/plugins/e2e-marketplace", import.meta.url),
);

// 所有 Claude Code Experiment 显式共享这一层，使镜像真正参与 link pairing。官方镜像
// 预装 CLI；30 分钟 TTL 让 plugin-reuse 的两条 attempt 能在同一个 Sandbox 内完成。
export const sandbox = dockerSandbox({
  source: { type: "image", image: NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE },
  user: "node",
  lifetimeMs: 30 * 60_000,
  resources: {
    cpus: 2,
    // Claude Code 的并行 plugin/skill 场景实测会击穿 3 GiB；4 GiB 是无 OOM 的最小验收档。
    memoryBytes: 4 * 1024 ** 3,
    pidsLimit: 512,
  },
});

// Plugin 安装属于 agent.setup；它引用的 Marketplace 必须更早由 Experiment layer
// 准备好，不能等到 Eval.test 前的 fixture setup 才上传。
export const pluginSandbox = sandbox.prepare(
  defineSandboxCommand(
    {
      id: "niceeval.e2e.claude-code.marketplace",
      revision: "1",
      inputs: { marketplace },
    },
    async (sb) => {
      await sb.putContent(marketplace, ".fixtures/e2e-marketplace");
    },
  ),
);
