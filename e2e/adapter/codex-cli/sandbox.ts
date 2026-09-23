import { dockerSandbox, NICEEVAL_CODEX_DOCKER_IMAGE } from "niceeval/sandbox";
import modelCatalog from "./configs/model-catalog.json" with { type: "json" };

// 所有 Codex Experiment 显式共享这一层，使镜像真正参与 link pairing。官方镜像预装 CLI；
// 30 分钟 TTL 让 plugin-reuse 的两波 attempt 能复用同一组 Sandbox。
export const sandbox = dockerSandbox({
  source: { type: "image", image: NICEEVAL_CODEX_DOCKER_IMAGE },
  user: "node",
  lifetimeMs: 30 * 60_000,
  resources: {
    cpus: 2,
    memoryBytes: 3 * 1024 ** 3,
    pidsLimit: 512,
  },
}).before(async (sandbox) => {
  // The pinned CLI predates this model and otherwise omits native apply_patch.
  // The baseline config explicitly selects this fixture-owned tool catalog.
  await sandbox.writeText("/tmp/niceeval-codex-model-catalog.json", JSON.stringify(modelCatalog));
});
