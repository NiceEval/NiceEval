// Replay captured upstream bytes through the public factory. Only the external
// Sandbox command/file boundary is substituted; parsing and diagnostics are real.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defineAgent, bubAgent } from "niceeval/adapter";

export function replayAgent(faults) {
  const native = bubAgent({ apiKey: "fixture-key", baseUrl: "https://fixture.invalid" });
  const states = new Map();
  const key = (ctx) => `${ctx.experimentId}:${ctx.evalId}:${ctx.attempt.index}`;
  return defineAgent({
    name: "bub-protocol-replay",
    evidenceCoverage: native.evidenceCoverage,
    async before(ctx) {
      const raw = await readFile(new URL("./bub-0.6.1.tape.jsonl", import.meta.url), "utf8");
      const lines = raw.split("\n");
      const firstFinish = lines.findIndex((line) => JSON.parse(line).payload.name === "loop.finish");
      const unknown = faults ? '{"type":"message","content":"foreign-poison"}\n{"kind":"future-event","payload":{"content":"unknown-poison"}}\n{"kind":"future-event","payload":{}}\n' : "";
      const first = lines.slice(0, firstFinish + 1).join("\n") + "\n" + unknown;
      const resumed = first + lines.slice(firstFinish + 1).join("\n");
      let sends = 0;
      const sandbox = {
        sandboxId: randomUUID(), workdir: "/fixture", provider: "protocol-fixture",
        async pathExists() { return true; },
        async writeText() {},
        async readText() { return sends === 1 ? first : resumed; },
        async runShell(command) {
          if (command === "printf '%s' $HOME") return { exitCode: 0, stderr: "", stdout: "/fixture-home" };
          sends++;
          return { exitCode: 0, stderr: "", stdout: "" };
        },
      };
      states.set(key(ctx), sandbox);
      await native.before?.(sandbox, { ...ctx, sandbox, reportInstallation() {} });
    },
    async send(input, ctx) {
      return native.send(input, { ...ctx, sandbox: states.get(key(ctx)) });
    },
    async after(ctx) {
      const sandbox = states.get(key(ctx));
      try { if (sandbox) await native.after?.(sandbox, { ...ctx, sandbox }); }
      finally { states.delete(key(ctx)); }
    },
  });
}
