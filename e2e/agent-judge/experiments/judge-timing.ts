import { defineExperiment } from "niceeval";
import { lifecycleSandbox, quickAgent } from "../agents/deterministic.ts";
export default defineExperiment({ adapter: quickAgent, sandbox: lifecycleSandbox, evals: ["judge-timing"] });
