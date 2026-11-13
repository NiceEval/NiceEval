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
  },
});
