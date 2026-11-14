import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    await t.sandbox.runShellOrThrow("rm -f fixture/binary.bin fixture/oversized.txt");
    await t.send("binary");
    t.sandbox
      .inDiff(/absent-content-token/, { content: "added" })
      .label("elided unavailable")
      .optional();
    t.sandbox
      .inDiff(/absent-content-token/, { content: "removed" })
      .label("elision unselected")
      .optional();
    t.sandbox
      .notInDiff(/absent-content-token/, { content: "both" })
      .label("absence elided unavailable")
      .optional();
    t.sandbox
      .notInDiff(/absent-content-token/, { content: "none" })
      .label("paths absence")
      .gate();
    t.sandbox
      .inDiff(/binary/g, { content: "none" })
      .label("paths witness")
      .gate();
    t.sandbox
      .notInDiff(/binary/, { content: "none" })
      .label("paths forbidden")
      .optional();
    t.sandbox
      .inDiff(/absent-content-token/, { content: "none" })
      .label("paths missing")
      .optional();
    t.sandbox
      .inDiff(/oversized/, { content: "none" })
      .label("paths oversized")
      .gate();
    t.sandbox.inDiff(/binary/).label("path despite elision");
  },
});
