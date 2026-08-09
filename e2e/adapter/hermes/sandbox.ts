import { dockerSandbox, NICEEVAL_HERMES_DOCKER_IMAGE } from "niceeval/sandbox";

// Sandbox 必须挂在 Experiment 上参与 link pairing；资源上限同时进入 template identity。
export const sandbox = dockerSandbox({
  source: { type: "image", image: NICEEVAL_HERMES_DOCKER_IMAGE },
  resources: {
    cpus: 2,
    memoryBytes: 3 * 1024 ** 3,
    pidsLimit: 512,
  },
});
