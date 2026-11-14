import { defineExperiment } from "niceeval";
import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

const sandbox = dockerSandbox({
  source: { type: "image", image: "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f" },
  pathPrepend: ["/tmp/niceeval-telemetry-tools"],
  user: "node",
  resources: { cpus: 1, memoryBytes: 536870912, pidsLimit: 128 },
});
const adapter = defineSandboxAgent({
  name: "telemetry-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: { identity: { agent: "node", version: "24", revision: "1" }, probe: shell("node --version") },
  tracing: { protocol: "http/json" },
  async send(_input, ctx) {
    const endpoint = ctx.telemetry!.endpoint;
    if (process.env.NICEEVAL_TELEMETRY_SLOW === "1") {
      await ctx.sandbox.runShellOrThrow("mkdir -p /tmp/niceeval-telemetry-tools");
      await ctx.sandbox.writeText(
        "/tmp/niceeval-telemetry-tools/dd",
        '#!/bin/sh\ncase "$*" in *skip=1*) sleep 45;; esac\nexec /bin/dd "$@"\n',
      );
      await ctx.sandbox.runShellOrThrow("chmod +x /tmp/niceeval-telemetry-tools/dd");
    }
    await ctx.sandbox.runCommandOrThrow("node", [
      "-e",
      `
      const start = BigInt(Date.now()) * 1000000n;
      const spans = Array.from({ length: 2000 }, (_, index) => ({
        traceId: "1234567890abcdef1234567890abcdef", spanId: (index + 1).toString(16).padStart(16, "0"),
        name: index === 0 ? "chat" : "plumbing", startTimeUnixNano: String(start), endTimeUnixNano: String(start + 1000000n),
        attributes: [{ key: "fixture.padding", value: { stringValue: "x".repeat(1024) } }],
      }));
      (async () => {
        for (const batch of [[spans[0]], spans.slice(1)]) {
          const response = await fetch(${JSON.stringify(endpoint)}, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: batch }] }] }) });
          if (!response.ok) throw new Error("trace export failed");
        }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
    ]);
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "telemetry-ok" }] };
  },
});
export default defineExperiment({ adapter, sandbox, sandboxCache: { before: "bypass" }, evals: ["telemetry-budget"] });
