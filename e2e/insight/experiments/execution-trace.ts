import { defineExperiment } from "niceeval";
import { executionTrace } from "../adapters/execution-trace.ts";

export default defineExperiment({ adapter: executionTrace, evals: ["execution-trace"] });
