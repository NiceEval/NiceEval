import { defineExperiment } from "niceeval";
import { externalUsage } from "../fixtures/external-usage.ts";
export default defineExperiment({ adapter: externalUsage, evals: ["external-usage", "usage-budget", "usage-budget-mixed"], attempts: 1 });
