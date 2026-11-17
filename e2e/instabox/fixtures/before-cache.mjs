// Observe only the external Provider boundary; IDs allow exact resource cleanup.
import { appendFileSync } from 'node:fs';
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await original(input, init);
  const url = String(input);
  if (init?.method === 'POST' && response.ok && url.startsWith('https://api.instabox.sh/v1/')) {
    const body = await response.clone().json();
    if (url.endsWith('/machines')) appendFileSync(process.env.NICEEVAL_PREPARE_RECEIPT, JSON.stringify({ machine: body.machineId }) + '\n');
    if (/\/machines\/[^/]+\/snapshots$/.test(url)) appendFileSync(process.env.NICEEVAL_PREPARE_RECEIPT, JSON.stringify({ snapshot: body.id, source: url.split('/').at(-2) }) + '\n');
  }
  return response;
};
