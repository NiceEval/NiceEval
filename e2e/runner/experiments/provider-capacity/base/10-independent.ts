import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { providerCapacityAgent } from "../../../agents/provider-capacity.ts";

const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const controlRoot = process.env.NICEEVAL_E2E_PROVIDER_CAPACITY_CONTROL_ROOT;

export default defineExperiment({
  description: "an unrelated Docker Provider remains dispatchable",
  agent: providerCapacityAgent,
  sandbox: dockerSandbox({
    source: { type: "image", image: NODE_IMAGE },
    user: "node",
    resources: {
      cpus: 1,
      memoryBytes: 512 * 1024 ** 2,
      pidsLimit: 128,
    },
  }),
  evals: ["provider-capacity-independent"],
  ...(controlRoot === undefined ? {} : { flags: { controlRoot } }),
});
