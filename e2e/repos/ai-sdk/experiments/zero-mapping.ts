import { defineExperiment } from "niceeval";
import { DEFAULT_MODEL } from "../src/backend/models.ts";
import agent from "../agents/zero-mapping.ts";

export default defineExperiment({
  description: "zero-mapping: fromAiSdk(result) used directly on a generateText() call, no factory in between",
  agent,
  model: DEFAULT_MODEL,
  runs: 3,
  earlyExit: true,
  evals: (id) => id.startsWith("zero-mapping/"),
  budget: 1,
});
