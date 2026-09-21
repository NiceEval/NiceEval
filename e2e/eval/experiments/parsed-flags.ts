import { appendFileSync } from "node:fs";
import { defineExperiment } from "niceeval";
import { flagsAdapter, parsedOutput } from "../fixtures/adapter-parse-flags.ts";

export default defineExperiment({
  adapter: flagsAdapter,
  flags: JSON.parse(process.env.NICEEVAL_E2E_FLAGS_INPUT ?? "{}"),
  evals: ["parsed-flags"],
  setup() { appendFileSync("flags-lifecycle.txt", "setup\n"); },
});

// A validator may retain its result; the experiment must own an independent copy.
if (parsedOutput) {
  parsedOutput.limit = 99;
  parsedOutput.nested.enabled = false;
  parsedOutput.nested.labels.push("mutated");
}
