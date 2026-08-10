import { defineExperiment } from "niceeval";
import { piAgentSubscribeFixtureAgent } from "../fixtures/pi-agent-subscribe.ts";

export default defineExperiment({
  description: "Pi Agent 0.82.1 real prompt() + subscribe() compatibility owner",
  agent: piAgentSubscribeFixtureAgent,
  evals: ["pi-agent-subscribe"],
  attempts: 1,
});
