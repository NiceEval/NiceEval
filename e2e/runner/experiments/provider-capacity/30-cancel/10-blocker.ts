import { defineExperiment } from "niceeval";
import { providerCapacityBlockerAgent } from "../../../agents/provider-capacity.ts";

const controlRoot = process.env.NICEEVAL_E2E_PROVIDER_CAPACITY_CONTROL_ROOT;
const scenario = process.env.NICEEVAL_E2E_PROVIDER_CAPACITY_SCENARIO;

export default defineExperiment({
  description: "an independent Attempt holds the invocation's only runner permit",
  agent: providerCapacityBlockerAgent,
  evals: ["provider-capacity-cancel-blocker"],
  maxConcurrency: 1,
  ...(controlRoot === undefined ? {} : { flags: { controlRoot, scenario } }),
});
