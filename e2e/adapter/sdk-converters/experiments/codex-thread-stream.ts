import { defineExperiment } from "niceeval";
import { codexThreadStreamFixtureAgent } from "../fixtures/codex-thread-stream.ts";

export default defineExperiment({
  description: "Offline locked Codex ThreadEvent frames through createCodexThreadEventStream",
  agent: codexThreadStreamFixtureAgent,
  evals: ["codex-thread-stream"],
  attempts: 1,
});
