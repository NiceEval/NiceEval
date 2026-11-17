import { defineExperiment } from "niceeval";
import { largeUsage } from "../applications/large-usage.ts";
export default defineExperiment({ adapter: largeUsage, evals: ["large-usage"] });
