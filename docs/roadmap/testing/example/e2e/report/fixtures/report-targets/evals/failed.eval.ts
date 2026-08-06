import { defineEval } from "niceeval";

export const failedEval = defineEval({
  id: "failed",
  prompt: "Return the deliberate fixture response.",
  expected: { verdict: "failed", tool: "shell" },
});
