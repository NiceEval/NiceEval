import { defineExperiment } from "niceeval";
import { executionDisplayAdapter } from "../adapters/execution-display.ts";

export default defineExperiment({ adapter: executionDisplayAdapter, evals: ["execution-display"] });
