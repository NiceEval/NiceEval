import { Effect } from "effect";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { defineExperiment } from "niceeval";
import { dockerSandbox, shell } from "niceeval/sandbox";

// Discovery and fixed Inspection import physically plan every experiment in the Repo, including when
// another owner is selected. The Docker profile owner injects the real alias before execution;
// without it this fixture stays plannable and fails explicitly only if somebody actually runs it.
const profile = process.env.NICEEVAL_E2E_DOCKER_PROFILE_ALIAS;

const agent = defineSandboxAgent({
  name: "docker-profile-cold-build-fixture",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  ensure: {
    identity: { agent: "docker-profile-cold-build-fixture", version: "1.0.0", revision: "1" },
    probe: shell("docker info >/dev/null"),
  },
  send: (_input, ctx) => Effect.tryPromise({
    try: async () => {
      if (profile === undefined) {
        throw new Error("NICEEVAL_E2E_DOCKER_PROFILE_ALIAS is required by the Docker profile E2E");
      }
      await ctx.sandbox.runShellOrThrow(
        'test "$(id -u)" = 1000 && docker info >/dev/null && printf "%s" profile-cold-build-ok',
        { signal: ctx.signal },
      );
      return {
        status: "completed",
        events: [{ type: "message", role: "assistant", text: "profile-cold-build-ok" }],
      };
    },
    catch: (cause) => cause,
  }),
});

const MiB = 1024 ** 2;

export default defineExperiment({
  description: "control-owned profile Dockerfile cold build",
  agent,
  sandbox: dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../fixtures/profile-cold-build/", import.meta.url),
    },
    ...(profile === undefined ? {} : {
      dockerAccess: {
        mode: "dind" as const,
        isolation: "raw-privileged" as const,
        storageProfile: profile,
      },
    }),
    user: "node",
    resources: {
      cpus: 1,
      memoryBytes: 1024 * MiB,
      pidsLimit: 512,
      ...(profile === undefined ? {} : { dockerDataBytes: 512 * MiB }),
      readOnlyRootfs: true,
      tmpfs: {
        "/home/node": { sizeBytes: 64 * MiB, mode: 0o700, uid: 1000, gid: 1000 },
        "/home/sandbox/workspace": { sizeBytes: 128 * MiB, mode: 0o755, uid: 1000, gid: 1000, executable: true },
        "/run": { sizeBytes: 64 * MiB, mode: 0o755 },
        "/tmp": { sizeBytes: 64 * MiB, mode: 0o1777 },
      },
    },
    readiness: {
      command: ["sh", "-lc", "docker info >/dev/null"],
      user: "node",
      timeoutMs: 30_000,
      intervalMs: 250,
    },
  }),
  evals: ["docker-profile-cold-build"],
});
