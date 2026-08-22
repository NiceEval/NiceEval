import { dockerSandbox } from "niceeval/sandbox";

export const sandbox = dockerSandbox({
  source: {
    type: "dockerfile",
    context: new URL("./", import.meta.url),
  },
  user: "node",
  resources: { cpus: 1, memoryBytes: 512 * 1024 ** 2, pidsLimit: 128 },
});
