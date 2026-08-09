import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerImageSandbox, shell } from "niceeval/sandbox";

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
};

const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const FIRST_REUSE_MARKER = "/tmp/niceeval-lifecycle-first-attempt";
const SECOND_READY_MARKER = "/tmp/niceeval-lifecycle-second-attempt-ready";
const WORKDIR_MARKER = "niceeval-lifecycle-workdir-marker";

export const lifecycleSandbox = dockerImageSandbox({
  image: NODE_IMAGE,
  user: "node",
  lifetimeMs: 5 * 60_000,
  resources: {
    cpus: 1,
    memoryBytes: 512 * 1024 ** 2,
    pidsLimit: 128,
  },
});

const ensure = {
  identity: { agent: "lifecycle-fixture", version: "24.19.0", revision: "1" },
  probe: shell('test "$(node --version)" = "v24.19.0"'),
};

export const quickAgent = defineSandboxAgent({
  name: "lifecycle-docker-quick",
  evidenceCoverage,
  ensure,
  async send(_input, ctx) {
    await ctx.sandbox.runShellOrThrow(
      'test "$(id -u)" != 0 && printf "%s" "lifecycle-fixture-ok"',
      { signal: ctx.signal },
    );
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "lifecycle-fixture-ok" }],
    };
  },
});

export const hangingAgent = defineSandboxAgent({
  name: "lifecycle-docker-reuse",
  evidenceCoverage,
  ensure,
  async send(_input, ctx) {
    const attempt = ctx.attempt?.index;
    if (attempt === 0) {
      await ctx.sandbox.runShellOrThrow(
        [
          "set -eu",
          `printf '%s' first > ${FIRST_REUSE_MARKER}`,
          `printf '%s' dirty > ${WORKDIR_MARKER}`,
        ].join("\n"),
        { signal: ctx.signal },
      );
      return {
        status: "completed",
        events: [{ type: "message", role: "assistant", text: "first reuse attempt completed" }],
      };
    }
    if (attempt === 1) {
      await ctx.sandbox.runShellOrThrow(
        [
          "set -eu",
          `test -f ${FIRST_REUSE_MARKER}`,
          `test ! -e ${WORKDIR_MARKER}`,
          `printf '%s' ready > ${SECOND_READY_MARKER}`,
          "sleep 600",
        ].join("\n"),
        { signal: ctx.signal },
      );
      throw new Error("second reuse attempt completed before interruption");
    }
    throw new Error(`unexpected lifecycle attempt index: ${String(attempt)}`);
  },
});
