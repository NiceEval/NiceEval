import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { providerCapacityAgent } from "../../agents/provider-capacity.ts";

const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const MiB = 1024 ** 2;
const profile = process.env.NICEEVAL_E2E_PROVIDER_CAPACITY_PROFILE;
const profileImage = process.env.NICEEVAL_E2E_PROVIDER_CAPACITY_IMAGE;
const controlRoot = process.env.NICEEVAL_E2E_PROVIDER_CAPACITY_CONTROL_ROOT;
const scenario = process.env.NICEEVAL_E2E_PROVIDER_CAPACITY_SCENARIO;

export default defineExperiment({
  description: "profile admission rejects every non-granted reservation state",
  agent: providerCapacityAgent,
  sandbox: dockerSandbox({
    source: { type: "image", image: profileImage ?? NODE_IMAGE },
    user: profile === undefined ? "node" : "root",
    ...(profile === undefined ? {} : {
      dockerAccess: {
        mode: "dind" as const,
        isolation: "raw-privileged" as const,
        storageProfile: profile,
      },
    }),
    resources: {
      cpus: 1,
      memoryBytes: 1024 * MiB,
      pidsLimit: 512,
      ...(profile === undefined ? {} : { dockerDataBytes: 512 * MiB }),
    },
    readiness: {
      command: ["sh", "-lc", "node --version >/dev/null"],
      user: "root",
      timeoutMs: 30_000,
      intervalMs: 100,
    },
  }),
  evals: ["provider-capacity-edge"],
  maxConcurrency: 1,
  ...(controlRoot === undefined ? {} : { flags: { controlRoot, scenario } }),
});
