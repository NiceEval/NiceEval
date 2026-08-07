import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";

const BASE = process.env.LOCAL_PROTOCOL_URL ?? "http://127.0.0.1:34201";

export default defineExperiment({
  description: "local-protocol http-error: fixture 返回 HTTP 500",
  agent: uiMessageStreamAgent({
    name: "local-protocol-http-error",
    url: `${BASE}/modes/error/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["http-error"],
});
