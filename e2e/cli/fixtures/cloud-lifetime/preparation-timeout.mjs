const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.instabox.sh") return originalFetch(input, init);
  const timeout = () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };
  if (url.pathname === "/v1/snapshots/sn_fixture") {
    if (process.env.NICEEVAL_TEST_TIMEOUT === "snapshot") timeout();
    return Response.json({ id: "sn_fixture", status: "ready" });
  }
  if (url.pathname === "/v1/machines" && init?.method === "POST") {
    if (process.env.NICEEVAL_TEST_TIMEOUT === "allocation") timeout();
    return Response.json({ id: "op_fixture", machineId: "machine_fixture", state: "succeeded", error: null });
  }
  if (url.pathname === "/v1/machines/machine_fixture") {
    if (init?.method === "DELETE") return Response.json({ error: { code: "not_found" } }, { status: 404 });
    return Response.json({ id: "machine_fixture", state: "running", operationId: null, runtime: { ready: true } });
  }
  if (url.pathname === "/v1/machines/machine_fixture/ssh-tokens") timeout();
  throw new Error("Unexpected fixture request");
};
