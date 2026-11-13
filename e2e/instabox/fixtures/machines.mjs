import { appendFileSync } from "node:fs";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  if (String(input) === "https://api.instabox.sh/v1/machines" && init?.method === "POST" && response.ok) {
    const body = await response.clone().json();
    appendFileSync(process.env.NICEEVAL_TRANSPORT_MACHINES, `${body.machineId}\n`);
  }
  return response;
};
