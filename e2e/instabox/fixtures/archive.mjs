import { appendFileSync } from "node:fs";
const fetch = globalThis.fetch;
let uploads = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const path = url.searchParams.get("path") ?? "";
  if (url.origin === "https://api.instabox.sh" && init?.method === "PUT" && path.startsWith("/tmp/niceeval-upload-")) {
    uploads++;
    appendFileSync(process.env.NICEEVAL_ARCHIVE_RECEIPT, "archive-put\n");
    // Corrupt only the third real transfer at the HTTP boundary. Extraction
    // must fail without installing a partial replacement over the sentinel.
    if (uploads === 3) init = { ...init, body: Buffer.from("truncated archive") };
  }
  if (url.origin === "https://api.instabox.sh" && path.startsWith("/tmp/niceeval-download-")) appendFileSync(process.env.NICEEVAL_ARCHIVE_RECEIPT, "archive-get\n");
  return fetch(input, init);
};
