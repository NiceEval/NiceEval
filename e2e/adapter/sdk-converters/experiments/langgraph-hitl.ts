import { defineExperiment } from "niceeval";
import { langGraphHitlFixtureAgent } from "../fixtures/langgraph-hitl.ts";

export default defineExperiment({
  description: "LangGraph 1.4.8 real interrupt/Command run boundary plus official HITL protocol",
  agent: langGraphHitlFixtureAgent,
  evals: ["langgraph-hitl"],
  attempts: 1,
});
