import { equals } from "niceeval/expect";
import { fileAttachmentAdapter } from "../adapters/file-attachments.ts";
export default fileAttachmentAdapter.defineEval({
  async test(t) { t.check(await t.reject(), equals(4)); },
});
