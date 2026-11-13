import { defineEval } from "niceeval";
export default defineEval({
  description: "Transport failure retains its cause and delivery counters",
  async test(t) {
    let message = "";
    try {
      await t.sandbox.runCommand("node", ["-e", "process.stdout.write('transport-fault-ready'); setTimeout(()=>{},120000)"]);
    } catch (cause) { message = cause instanceof Error ? cause.message : String(cause); }
    for (const expected of ["fixture-client-disconnect", "reconnectAttempts=", "elapsedMs=", "stdoutBytes=", "stderrBytes="]) {
      if (!message.includes(expected)) throw new Error(`Missing transport diagnostic ${expected}: ${message}`);
    }
    if (message.includes("fixture-secret-token")) throw new Error("SSH diagnostic leaked a token");
    for (const [name, operation] of [
      ["command", () => t.sandbox.runCommand("true")],
      ["read", () => t.sandbox.readText("missing.txt")],
      ["write", () => t.sandbox.writeText("after.txt", "late")],
      ["exists", () => t.sandbox.pathExists("missing.txt")],
    ] as const) {
      let later = "";
      try { await operation(); }
      catch (cause) { later = cause instanceof Error ? cause.message : String(cause); }
      if (!later.includes("fixture-client-disconnect") || !later.includes("reconnectAttempts=3") || later.includes("HTTP 404")) {
        throw new Error(`Retired ${name} lost the transport cause: ${later}`);
      }
    }
    if (!message.includes("reconnectAttempts=3")) throw new Error(`Reconnect budget was not used: ${message}`);
  },
});
