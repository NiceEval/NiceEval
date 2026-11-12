import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";
export default defineExperiment({ adapter: deterministicAgent, evals: ["root-order"] });
