import { defineEval } from "niceeval";

export default defineEval({
  description: "Collect remote telemetry after the agent finishes",
  async test(t) {
    await t.send("Export telemetry");
  },
});
