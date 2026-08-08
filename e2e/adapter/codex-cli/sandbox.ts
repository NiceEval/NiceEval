import { dockerSandbox } from "niceeval/sandbox";

// 所有 Codex Experiment 显式共享这一层，使镜像真正参与 link pairing。官方镜像预装 CLI；
// 30 分钟 TTL 让 plugin-reuse 的两条 attempt 能在同一个 Sandbox 内完成。
export const sandbox = dockerSandbox({
  source: { type: "image", image: "niceeval/codex:v0.9.1" },
  user: "node",
  lifetimeMs: 30 * 60_000,
  resources: {
    cpus: 2,
    memoryBytes: 3 * 1024 ** 3,
    pidsLimit: 512,
  },
});
