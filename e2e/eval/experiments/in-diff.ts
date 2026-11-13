import { defineExperiment } from "niceeval";
import { inDiffAgent } from "../agents/in-diff.ts";
import { readLimitedSandbox } from "./assertion-sandbox.ts";
export default defineExperiment({ adapter: inDiffAgent, sandbox: readLimitedSandbox, evals: ["in-diff", "in-diff-elided"] });
