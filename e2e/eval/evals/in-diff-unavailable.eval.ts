import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    await t.send("change");
    // Fault at the external Provider file-read boundary after the send completes.
    await t.sandbox.writeText("fixture/fail-reads", "fail");
    t.sandbox.notInDiff(/absent-content-token/, { content: "none" }).label("paths unavailable absence").gate();
    t.sandbox.inDiff(/content/, { content: "none" }).label("paths unavailable witness").gate();
  },
});
