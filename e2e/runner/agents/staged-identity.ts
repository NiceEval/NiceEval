import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineSandboxAgent, type AgentIdentity } from "niceeval/adapter";
import { dockerSandbox, sandboxContent, shell } from "niceeval/sandbox";

export function stagedIdentityExperiment(identity: AgentIdentity, marker: string) {
  let prepares = 0;
  return defineExperiment({
    attempts: 2, maxConcurrency: 2,
    adapter: defineSandboxAgent({
      name: `staged-identity-${marker}`, evidenceCoverage: completeEvidenceCoverage,
      install: { identity, probe: shell("test -f /tmp/identity-installed") },
      installers: [{
        identity, installMode: "staged",
        async prepareArtifact({ targetPlatform }) {
          if (++prepares !== 1) throw new Error(`duplicate prepare ${marker}`);
          console.error(`prepared staged identity ${marker}`);
          const file = resolve(`payload-${marker}.txt`);
          await writeFile(file, marker);
          return { platform: targetPlatform, content: sandboxContent.file(pathToFileURL(file)), targetPath: "/tmp/identity-payload", install: { kind: "self-contained", binPath: "unused" } };
        },
        async install(sandbox, { artifact }) {
          await sandbox.putContent(artifact.content, artifact.targetPath);
          await sandbox.runShellOrThrow(`test "$(cat /tmp/identity-payload)" = '${marker}' && touch /tmp/identity-installed`);
        },
      }],
      async send() { return { status: "completed", events: [] }; },
    }),
    sandbox: dockerSandbox({ source: { type: "image", image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5" } }),
    evals: ["agent-install-identity"],
  });
}
