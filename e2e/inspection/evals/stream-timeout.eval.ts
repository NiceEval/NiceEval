import { fileAttachmentAdapter } from "../adapters/file-attachments.ts";
export default fileAttachmentAdapter.defineEval({
  timeoutMs: 1_000,
  async test(t) { await t.waitForCancellation(); },
});
