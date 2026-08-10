import { defineExperiment } from "niceeval";
import { langGraphCoreFixtureAgent } from "../fixtures/langgraph-core.ts";

export default defineExperiment({
  description: "LangGraph 1.4.8 GraphRunStream and official protocol core owner",
  agent: langGraphCoreFixtureAgent,
  evals: ["langgraph-core"],
  attempts: 1,
});
