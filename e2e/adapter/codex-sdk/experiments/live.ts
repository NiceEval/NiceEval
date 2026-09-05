import { defineExperiment } from "niceeval";
import consumer from "../src/consumer.ts";

export default defineExperiment({
  description: "Codex SDK converter: one real ThreadEvent stream plus native thread resume",
  agent: consumer,
  model: "gpt-5.6-luna",
  evals: ["live-compatibility"],
  attempts: 1,
});
