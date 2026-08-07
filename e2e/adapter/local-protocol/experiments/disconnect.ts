import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";

const BASE = process.env.LOCAL_PROTOCOL_URL ?? "http://127.0.0.1:34201";

export default defineExperiment({
  description: "local-protocol disconnect: 半截 SSE 后硬断连接",
  agent: uiMessageStreamAgent({
    name: "local-protocol-disconnect",
    url: `${BASE}/modes/disconnect/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["disconnect"],
});
