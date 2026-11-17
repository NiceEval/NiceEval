import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

export default defineEval({
  async test(t) {
    const missing = await t.sandbox.runCommand("niceeval-missing-command-evidence");
    t.check(missing, commandSucceeded()).label("missing command").gate();
    const failed = await t.sandbox.runCommand(
      "node",
      [
        "-e",
        'process.stdout.write("o".repeat(20000) + "stdout-tail"); process.stderr.write("e".repeat(20000) + "synthetic-command-secret stderr-tail"); process.exitCode = 23',
      ],
      { sensitiveValues: ["synthetic-command-secret"] },
    );
    t.check(failed, commandSucceeded()).label("nonzero command").gate();
  },
});
