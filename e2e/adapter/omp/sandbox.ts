import { dockerSandbox, NICEEVAL_OMP_DOCKER_IMAGE } from "niceeval/sandbox";

export const sandbox = dockerSandbox({
  source: { type: "image", image: NICEEVAL_OMP_DOCKER_IMAGE },
  resources: {
    cpus: 2,
    memoryBytes: 3 * 1024 ** 3,
    pidsLimit: 512,
  },
});
