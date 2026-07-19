import { defineExperiment } from "niceeval";
import { DEFAULT_MODEL } from "../src/backend/models.ts";
import agent from "../agents/ui-message-stream.ts";

// runs: 3 + earlyExit absorbs a single real-model blip; three consecutive misses is a
// genuine regression and the matrix should stay red for it.
export default defineExperiment({
  description: "ui-message-stream: HTTP useChat backend (SSE, full-history replay, approval rewrite-resend)",
  agent,
  model: DEFAULT_MODEL,
  runs: 3,
  earlyExit: true,
  evals: (id) => id.startsWith("ui-message-stream/"),
  budget: 1,
});
