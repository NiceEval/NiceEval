import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { FIXTURE_BASE_URL } from "../src/fixture/address.ts";

export default defineExperiment({
  description: "local-protocol http-error: fixture 返回 HTTP 500",
  agent: uiMessageStreamAgent({
    name: "local-protocol-http-error",
    url: `${FIXTURE_BASE_URL}/modes/error/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["http-error"],
});
