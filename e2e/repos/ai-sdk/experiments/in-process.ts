import { defineExperiment } from "niceeval";
import { DEFAULT_MODEL } from "../src/backend/models.ts";
import agent from "../agents/in-process.ts";

export default defineExperiment({
  description: "in-process: aiSdkAgent generate() loop, tracing: aiSdkOtel() wired (this repo's OTel proof)",
  agent,
  model: DEFAULT_MODEL,
  runs: 3,
  earlyExit: true,
  evals: (id) => id.startsWith("in-process/"),
  budget: 1,
});
