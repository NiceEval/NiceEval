import { defineExperiment } from "niceeval";
import agent from "../agents/frame-session.ts";

export default defineExperiment({
  description: "Attempt-owned SSE survives waiting and closes on every terminal path",
  adapter: agent,
  model: "local-frame-fixture",
  evals: ["frame-session"],
  attempts: 1,
  timeoutMs: process.env.NICEEVAL_FRAME_SCENARIO === "race" ? 4_000 : 15_000,
});
