import { dockerSandbox } from "niceeval/sandbox";
import { IMAGE_TAG } from "./scripts/build-docker-env.ts";

// 两个 Experiment 共用同一份环境声明。它必须挂在 Experiment 上参与 link pairing，
// 不能放进 Config 当项目级兜底。这个本地镜像刻意不预装 Bub/Python plugin，保留
// adapter 首次安装及 pythonPlugins 收敛的真实路径。
export const sandbox = dockerSandbox({
  source: { type: "image", image: IMAGE_TAG },
  user: "node",
  resources: {
    cpus: 2,
    memoryBytes: 3 * 1024 ** 3,
    pidsLimit: 512,
  },
});
