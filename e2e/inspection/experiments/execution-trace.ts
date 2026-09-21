import { defineExperiment } from "niceeval";
import { executionTraceAdapter } from "../adapters/execution-trace.ts";

export default defineExperiment({ adapter: executionTraceAdapter, evals: ["execution-trace"] });
