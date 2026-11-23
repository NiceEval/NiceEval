import { defineEval } from "niceeval";
export default defineEval({
  description: "An EOF process survives a lost connection with exact raw bytes and status",
  async test(t) {
    const roundTrips = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await t.sandbox.runCommandOrThrow("true");
      roundTrips.push(performance.now() - started);
    }
    // Calibrate on the same connection so one unusually fast sample does not
    // set the allowance for all twenty commands.
    const roundTrip = Math.max(...roundTrips);
    const started = performance.now();
    await t.sandbox.runCommandOrThrow("true");
    const single = performance.now() - started;
    const repeated = performance.now();
    for (let i = 0; i < 20; i++) await t.sandbox.runCommandOrThrow("true");
    const total = performance.now() - repeated;
    await t.sandbox.runCommandOrThrow("true", ["command-timing", String(single), String(roundTrip), String(total)]);
    await t.sandbox.runShellOrThrow("sleep 60 &", { timeoutMs: 10_000 });
    await (await t.send("exercise raw-byte process reconnect")).succeeded().orStop();
  },
});
