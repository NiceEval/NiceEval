import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../../agents/deterministic.ts";
export default defineExperiment({ adapter: deterministicAgent(), sandbox: deterministicSandbox, evals: ["assertion-matrix"], attempts: 2 });
