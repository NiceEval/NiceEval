import { defineExperiment } from "niceeval";
import { changeScopeAgent } from "../agents/change-scope.ts";
import { readLimitedSandbox } from "./assertion-sandbox.ts";
export default defineExperiment({
  adapter: changeScopeAgent,
  sandbox: readLimitedSandbox,
  evals: ["unchanged-within", "unchanged-within-empty"],
});
