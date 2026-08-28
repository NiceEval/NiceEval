import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  sandboxLayer,
  shell,
} from "niceeval/sandbox";
import { setupPrefixResumeGate, setupPrefixResumeLayer } from "../fixtures/setup-prefix/resume-gate.ts";

interface SetupPrefixEvidence {
  readonly baseVersion: string;
  readonly runtimeMode: string;
  readonly canonicalToken: string;
  readonly buildToken: string;
  readonly fixtureToken: string;
  readonly middleToken: string;
  readonly middleVersion: string;
  readonly envToken: string;
  readonly publicEnv: string;
  readonly fixture: string;
  readonly demand: string;
  readonly sandboxId: string;
}

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "deterministic fixture has no token usage" } as const,
};

const ensure = {
  identity: { agent: "lifecycle-setup-prefix", version: "1", revision: "1" },
  probe: shell("node --version >/dev/null"),
};

const publicEnv = process.env.NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV ?? "PUBLIC_MODE=default\n";
if (!/^PUBLIC_MODE=[a-z]+\n$/u.test(publicEnv)) {
  throw new Error("NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV must be a public PUBLIC_MODE assignment");
}
const runtimeMode = process.env.NICEEVAL_E2E_SETUP_PREFIX_MODE ?? "default";

let sandbox = sandboxLayer();
if (setupPrefixResumeLayer === 3) {
  sandbox = sandbox.before(shell({
    id: "resume-after-layer-3-gate",
    command: [
      "set -eu",
      ...setupPrefixResumeGate(3),
    ].join("\n"),
    changeFrequency: changeFrequency.frequent + 20,
    dependsOn: [actionRef("env-execution-probe")],
  }));
}

function demandFrom(input: string): string {
  const match = /^setup-prefix-demand:(v[12])$/u.exec(input);
  if (match === null) throw new Error(`unexpected setup-prefix input: ${JSON.stringify(input)}`);
  return match[1]!;
}

export const setupPrefixAgent = defineSandboxAgent({
  name: "lifecycle-setup-prefix",
  evidenceCoverage,
  sandbox,
  ensure,
  send: async (input, ctx) => {
      const demand = demandFrom(input.text);
      if (await ctx.sandbox.pathExists(".setup-prefix/agent-pollution")) {
        throw new Error("a private SetupPrefix clone retained Agent/test writable state from an earlier Attempt");
      }

      const [
        baseVersion,
        canonicalToken,
        buildToken,
        fixtureToken,
        middleToken,
        middleVersion,
        envToken,
        publicEnv,
        fixture,
        hostname,
      ] = await Promise.all([
        ctx.sandbox.readText("/opt/niceeval-e2e/base-version"),
        runtimeMode === "canonical-json"
          ? ctx.sandbox.readText(".setup-prefix/canonical-token")
          : Promise.resolve("not-requested"),
        ctx.sandbox.readText("/opt/niceeval-e2e/build-token"),
        ctx.sandbox.readText(".setup-prefix/fixture-token"),
        ctx.sandbox.readText(".setup-prefix/middle-token"),
        ctx.sandbox.readText(".setup-prefix/middle-version"),
        ctx.sandbox.readText(".setup-prefix/env-token"),
        ctx.sandbox.readText(".env"),
        ctx.sandbox.readText("fixture/input.txt"),
        ctx.sandbox.runShellOrThrow("cat /etc/hostname", { signal: ctx.signal }),
      ]);

      await ctx.sandbox.writeText(".setup-prefix/agent-pollution", `${demand}\n`);
      const evidence: SetupPrefixEvidence = {
        baseVersion: baseVersion.trim(),
        runtimeMode,
        canonicalToken: canonicalToken.trim(),
        buildToken: buildToken.trim(),
        fixtureToken: fixtureToken.trim(),
        middleToken: middleToken.trim(),
        middleVersion: middleVersion.trim(),
        envToken: envToken.trim(),
        publicEnv,
        fixture,
        demand,
        sandboxId: hostname.stdout.trim(),
      };
      const encoded = Buffer.from(JSON.stringify(evidence), "utf8").toString("base64url");

      return {
        status: "completed",
        events: [{
          type: "message",
          role: "assistant",
          text: `setup-prefix-demand:${demand} setup-prefix-evidence:${encoded}`,
        }],
      };
  },
});
