import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { fixtureBaseUrl } from "../src/fixture/address.ts";

export default defineExperiment({
  description: "local-protocol live progress: flushed complete tool input remains active before completion",
  agent: uiMessageStreamAgent({
    name: "local-protocol-live-progress",
    url: `${fixtureBaseUrl()}/modes/live-progress/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["live-progress"],
});
