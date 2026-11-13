import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, sandboxContent, shell } from "niceeval/sandbox";

const identity = { agent: "staged-payload-fixture", version: "1.0.0", revision: "1" };
let prepares = 0;
export default defineExperiment({
  attempts: 4, maxConcurrency: 4, earlyExit: false,
  adapter: defineSandboxAgent({
    name: "staged-payload-fixture", evidenceCoverage: completeEvidenceCoverage,
    install: { identity, probe: shell("test -f /tmp/staged-payload-ready") },
    installers: [{
      identity, installMode: "staged",
      async prepareArtifact({ targetPlatform }) {
        if (++prepares !== 1) throw new Error("staged payload was prepared more than once");
        const directory = resolve(".e2e-payload");
        await mkdir(directory, { recursive: true });
        const path = resolve(directory, "payload.bin");
        const file = await open(path, "w");
        try {
          const chunk = Buffer.alloc(64 * 1024, 97);
          for (let index = 0; index < 768; index++) await file.write(chunk);
        } finally { await file.close(); }
        return {
          platform: targetPlatform, content: sandboxContent.file(pathToFileURL(path)),
          targetPath: "/tmp/staged-payload.bin", install: { kind: "self-contained", binPath: "unused" },
        };
      },
      async install(sandbox, { artifact }) {
        // Observe the synchronous materialization at the public upload boundary,
        // before any await can mix another Attempt's allocation into this delta.
        const before = process.memoryUsage().arrayBuffers;
        const upload = sandbox.putContent(artifact.content, artifact.targetPath);
        const allocated = process.memoryUsage().arrayBuffers - before;
        await upload;
        if (allocated >= 32 * 1024 * 1024) {
          throw new Error(`staged upload materialized a payload-sized buffer: ${allocated}`);
        }
        await sandbox.runShellOrThrow("test $(wc -c < /tmp/staged-payload.bin) = 50331648 && touch /tmp/staged-payload-ready");
      },
    }],
    async send() { return { status: "completed", events: [] }; },
  }),
  sandbox: dockerSandbox({ source: { type: "image", image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5" } }),
  evals: ["staged-payload"],
});
