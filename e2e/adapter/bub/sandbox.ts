import { dockerSandbox, NICEEVAL_BUB_DOCKER_IMAGE } from "niceeval/sandbox";

// 两个 Experiment 共用同一份环境声明。它必须挂在 Experiment 上参与 link pairing，
// 不能放进 Config 当项目级兜底。官方镜像预装 NiceEval 锁定的 Bub 基线；adapter
// 仍通过自身的身份探测和配置覆盖验证运行行为。
export const sandbox = dockerSandbox({
  source: { type: "image", image: NICEEVAL_BUB_DOCKER_IMAGE },
  user: "node",
  resources: {
    cpus: 2,
    memoryBytes: 3 * 1024 ** 3,
    pidsLimit: 512,
  },
});
