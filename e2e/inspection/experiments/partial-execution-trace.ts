import { defineExperiment } from "niceeval";
import { partialExecutionTraceAdapter } from "../adapters/execution-trace-partial.ts";

export default defineExperiment({ adapter: partialExecutionTraceAdapter, evals: ["partial-execution-trace"] });
