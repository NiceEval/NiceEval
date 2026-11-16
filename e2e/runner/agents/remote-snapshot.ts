import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, e2bSandbox, instaboxSandbox, openSandbox, shell } from "niceeval/sandbox";
const provider = process.env.NICEEVAL_SNAPSHOT_FIXTURE_PROVIDER;
const base =
  provider === "docker"
    ? dockerSandbox({ source: { type: "image", image: process.env.NICEEVAL_SNAPSHOT_FIXTURE_IMAGE! }, user: "root" })
    : provider === "instabox"
      ? instaboxSandbox({ template: "fixture" })
      : provider === "opensandbox"
        ? openSandbox({
            image: "fixture@sha256:" + "1".repeat(64),
            targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
          })
        : e2bSandbox({ template: "fixture" });
export const snapshotSandbox = base.before(
  shell({
    id: "shared-prefix",
    command: "printf shared > /tmp/shared-prefix",
  }),
);
export const snapshotAgent = defineSandboxAgent({
  name: "snapshot-fixture",
  evidenceCoverage: { ...completeEvidenceCoverage, usage: { status: "unavailable", reason: "deterministic fixture" } },
  install: { identity: { agent: "snapshot-fixture", version: "1", revision: "1" }, probe: shell("true") },
  send: async (_input, ctx) => ({
    status: "completed",
    events: [{ type: "message", role: "assistant", text: await ctx.sandbox.readText("/tmp/shared-prefix") }],
  }),
});
