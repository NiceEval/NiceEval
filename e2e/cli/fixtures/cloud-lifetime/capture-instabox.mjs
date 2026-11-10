import { appendFile } from "node:fs/promises";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "api.instabox.sh") return originalFetch(input, init);
  if (url.pathname !== "/v1/machines" || init?.method !== "POST") {
    throw new Error(`Unexpected Instabox fixture request: ${url.pathname}`);
  }
  await appendFile(process.env.NICEEVAL_TEST_CREATE_REQUESTS, `${init.body}\n`);
  // Reject at the external allocation boundary: no machine or cleanup is simulated.
  return Response.json({ error: { code: "fixture-allocation-rejected" } }, { status: 400 });
};
