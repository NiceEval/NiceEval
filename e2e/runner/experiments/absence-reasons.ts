import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

const mode = process.env.NICEEVAL_ABSENCE_MODE;

export default defineExperiment({
  adapter: defineAgent({
    name: "absence-reasons",
    evidenceCoverage: completeEvidenceCoverage,
    send: async () => {
      if (mode === "fail-fast") throw new Error("deterministic absence fixture failure");
      return {
        status: "completed",
        events: [{ type: "message", role: "assistant", text: "runner-timing-ok" }],
      };
    },
  }),
  evals: ["timing/basic"],
  attempts: 3,
  maxConcurrency: 1,
  earlyExit: mode === "early-exit",
  ...(mode === "budget" ? { budget: 0 } : {}),
});
