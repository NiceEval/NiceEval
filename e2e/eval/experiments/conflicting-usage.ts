import { defineExperiment } from "niceeval";
import { externalUsage } from "../fixtures/external-usage.ts";
export default defineExperiment({ adapter: externalUsage, evals: ["conflicting-usage"], attempts: 1 });
