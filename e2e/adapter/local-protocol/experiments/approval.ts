import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { fixtureBaseUrl } from "../src/fixture/address.ts";

export default defineExperiment({
  description: "local-protocol approval: typed UI Message Stream chunks drive approve / deny resume",
  agent: uiMessageStreamAgent({
    name: "local-protocol-approval",
    url: `${fixtureBaseUrl()}/modes/approval/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["approval-lifecycle"],
  attempts: 1,
});
