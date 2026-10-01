import { defineExperiment } from "niceeval";
import { usageSealAdapter } from "../adapters/usage-seal.ts";

export default defineExperiment({ adapter: usageSealAdapter, evals: ["usage-seal-caught-write"], attempts: 1 });
