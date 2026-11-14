import { createHash } from "node:crypto";
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  async test(t) {
    let stdout = "";
    let stderr = "";
    let stdoutReleased = false;
    let stderrReleased = false;
    const result = await t.sandbox.runCommand(
      "node",
      [
        "-e",
        `
      const fs = require("node:fs");
      async function wait(path) {
        while (!fs.existsSync(path)) await new Promise(resolve => setTimeout(resolve, 10));
      }
      (async () => {
        process.stdout.write(Buffer.concat([Buffer.from("out:"), Buffer.from([0xe4])]));
        await wait("stdout-release");
        process.stdout.write(Buffer.from([0xb8, 0xad]));
        process.stderr.write(Buffer.concat([Buffer.from("err:"), Buffer.from([0xf0])]));
        await wait("stderr-release");
        process.stderr.write(Buffer.from([0x9f, 0x8c, 0x8d]));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      ],
      {
        onStdout: async (chunk) => {
          stdout += chunk;
          if (!stdoutReleased && stdout.includes("out:")) {
            stdoutReleased = true;
            await t.sandbox.writeText("stdout-release", "release");
          }
        },
        onStderr: async (chunk) => {
          stderr += chunk;
          if (!stderrReleased && stderr.includes("err:")) {
            stderrReleased = true;
            await t.sandbox.writeText("stderr-release", "release");
          }
        },
      },
    );
    t.check(result.exitCode, equals(0));
    t.check(result.stdout, equals("out:中"));
    t.check(result.stderr, equals("err:🌍"));
    t.check(stdout, equals("out:中"));
    t.check(stderr, equals("err:🌍"));

    const streamed = createHash("sha256");
    const large = await t.sandbox.runCommand(
      "node",
      [
        "-e",
        `
      const fs = require("node:fs");
      const block = Buffer.alloc(65536, "x");
      for (let index = 0; index < 128; index++) fs.writeSync(1, block);
    `,
      ],
      {
        onStdout: (chunk) => {
          streamed.update(chunk);
        },
      },
    );
    const expected = createHash("sha256")
      .update("x".repeat(8 * 1024 * 1024))
      .digest("hex");
    t.check(large.exitCode, equals(0));
    t.check(streamed.digest("hex"), equals(expected));
    t.check(createHash("sha256").update(large.stdout).digest("hex"), equals(expected));
  },
});
