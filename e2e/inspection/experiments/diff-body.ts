import { defineExperiment } from "niceeval";
import adapter from "../agents/diff-body.ts";
import { deterministicSandbox } from "../agents/deterministic.ts";
export default defineExperiment({ evals: ["diff-body"], adapter, sandbox: deterministicSandbox });
