import { equals } from "niceeval/expect";
import { fileAttachmentAdapter } from "../adapters/file-attachments.ts";
export default fileAttachmentAdapter.defineEval({
  timeoutMs: 120_000,
  async test(t) {
    t.check(await t.archive(), equals(280 * 1024 * 1024));
  },
});
