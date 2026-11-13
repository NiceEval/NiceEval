import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    await t.send("binary");
    t.sandbox.inDiff(/absent-content-token/, { content: "added" }).label("elided unavailable").optional();
    t.sandbox.inDiff(/absent-content-token/, { content: "removed" }).label("elision unselected").optional();
    t.sandbox.inDiff(/binary/).label("path despite elision");
  },
});
