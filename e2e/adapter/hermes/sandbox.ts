import { dockerSandbox } from "niceeval/sandbox";
import { IMAGE_TAG } from "./scripts/build-docker-env.ts";

// Sandbox 必须挂在 Experiment 上参与 link pairing；资源上限同时进入 template identity。
export const sandbox = dockerSandbox({
  source: { type: "image", image: IMAGE_TAG },
  resources: {
    cpus: 2,
    memoryBytes: 3 * 1024 ** 3,
    pidsLimit: 512,
  },
});
