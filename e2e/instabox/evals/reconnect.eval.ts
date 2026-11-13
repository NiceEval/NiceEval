import { defineEval } from "niceeval";
export default defineEval({
  description: "An EOF process survives a lost connection with exact raw bytes and status",
  async test(t) {
    const started = performance.now();
    await t.sandbox.runCommandOrThrow("true");
    const single = performance.now() - started;
    const repeated = performance.now();
    for (let i = 0; i < 20; i++) await t.sandbox.runCommandOrThrow("true");
    const total = performance.now() - repeated;
    await t.sandbox.runCommandOrThrow("true", ["command-timing", String(Math.round(single)), String(Math.round(total))]);
    if (total > single + 20 * single) throw new Error(`Repeated commands exceeded the measured round-trip allowance: single=${single}, total20=${total}`);
    await (await t.send("exercise raw-byte process reconnect")).succeeded().orStop();
  },
});
