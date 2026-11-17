import { appendFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

const originalFetch = globalThis.fetch;
let deletion;
const mode = process.env.NICEEVAL_DELETE_MODE;
const receipt = (event) => appendFileSync(process.env.NICEEVAL_DELETE_RECEIPT, `${event}\n`);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.instabox.sh") return originalFetch(input, init);
  if (deletion && url.pathname === `/v1/operations/${deletion.operation.id}`) {
    await setTimeout(1000, undefined, { signal: init?.signal });
    if (mode === "absent" || performance.now() - deletion.started < 28_000) {
      receipt("operation-running");
      return Response.json({ ...deletion.operation, state: "running", error: null });
    }
  }
  if (deletion && url.pathname === `/v1/machines/${deletion.operation.machineId}` && !init?.method) {
    if (mode !== "absent" && performance.now() - deletion.started < 28_000) {
      receipt("machine-deleting");
      return Response.json({ id: deletion.operation.machineId, state: "deleting", operationId: deletion.operation.id, runtime: { ready: false } });
    }
    receipt("machine-check");
  }
  const response = await originalFetch(input, init);
  if (init?.method === "DELETE" && url.pathname.startsWith("/v1/machines/") && response.ok) {
    const operation = await response.clone().json();
    deletion ??= { operation, started: performance.now() };
    receipt("delete-accepted");
    if (mode === "conflict") return Response.json({ error: { code: "operation_conflict" } }, { status: 409 });
    return Response.json({ ...operation, state: "running", error: null }, { status: 202 });
  }
  return response;
};
