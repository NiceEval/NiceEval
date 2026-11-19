import { defineExperiment } from "niceeval";
import { lateCreateCleanup } from "../fixtures/custom-applications.ts";
export default defineExperiment({ adapter: lateCreateCleanup, evals: ["custom-late-cleanup"], timeoutMs: 500 });
