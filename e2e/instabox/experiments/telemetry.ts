import { defineExperiment } from "niceeval";
import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { instaboxSandbox, shell } from "niceeval/sandbox";

export default defineExperiment({
  adapter: defineSandboxAgent({
    name: "telemetry-fixture",
    ensure: { identity: { agent: "node", version: "22", revision: "1" }, probe: shell("node --version") },
    evidenceCoverage: completeEvidenceCoverage,
    tracing: { protocol: "http/json" },
    async send(_input, ctx) {
      await ctx.sandbox.runCommandOrThrow("node", [
        "-e",
        `
        const start = BigInt(Date.now()) * 1000000n;
        (async () => {
          for (let batch = 0; batch < 160; batch++) {
            const spans = Array.from({ length: 100 }, (_, index) => ({
              traceId: '1234567890abcdef1234567890abcdef',
              spanId: (batch * 100 + index + 1).toString(16).padStart(16, '0'),
              name: 'remote-telemetry', startTimeUnixNano: String(start), endTimeUnixNano: String(start + 1000000n),
              attributes: [{ key: 'fixture.padding', value: { stringValue: 'x'.repeat(1024) } }],
            }));
            const response = await fetch(${JSON.stringify(ctx.telemetry!.endpoint)}, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] }),
            });
            if (!response.ok) throw Error('trace export failed');
          }
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `,
      ]);
      return { status: "completed", events: [] };
    },
  }),
  sandbox: instaboxSandbox({ templateId: "universal", lifetimeMs: 600_000 }),
  evals: ["telemetry"],
});
