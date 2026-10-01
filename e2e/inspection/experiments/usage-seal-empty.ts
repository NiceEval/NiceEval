import { defineExperiment } from "niceeval";
import { usageSealAdapter } from "../adapters/usage-seal.ts";

export default defineExperiment({ adapter: usageSealAdapter, evals: ["usage-seal-empty"], attempts: 1 });
