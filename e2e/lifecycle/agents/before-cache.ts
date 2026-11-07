import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  sandboxLayer,
  shell,
} from "niceeval/sandbox";
import { beforeCacheResumeGate, beforeCacheResumeLayer } from "../fixtures/before-cache/resume-gate.ts";

interface BeforeCacheEvidence {
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
  identity: { agent: "lifecycle-before-cache", version: "1", revision: "1" },
  probe: shell("node --version >/dev/null"),
};

const publicEnv = process.env.NICEEVAL_E2E_BEFORE_CACHE_PUBLIC_ENV ?? "PUBLIC_MODE=default\n";
if (!/^PUBLIC_MODE=[a-z]+\n$/u.test(publicEnv)) {
  throw new Error("NICEEVAL_E2E_BEFORE_CACHE_PUBLIC_ENV must be a public PUBLIC_MODE assignment");
}
const runtimeMode = process.env.NICEEVAL_E2E_BEFORE_CACHE_MODE ?? "default";

let sandbox = sandboxLayer();
if (beforeCacheResumeLayer === 3) {
  sandbox = sandbox.before(shell({
    id: "resume-after-layer-3-gate",
    command: [
      "set -eu",
      ...beforeCacheResumeGate(3),
    ].join("\n"),
    changeFrequency: changeFrequency.frequent + 20,
    dependsOn: [actionRef("env-execution-probe")],
  }));
}

function demandFrom(input: string): string {
  const match = /^before-cache-demand:(v[12])$/u.exec(input);
  if (match === null) throw new Error(`unexpected before-cache input: ${JSON.stringify(input)}`);
  return match[1]!;
}

export const beforeCacheAgent = defineSandboxAgent({
  name: "lifecycle-before-cache",
  evidenceCoverage,
  sandbox,
  ensure,
  send: async (input, ctx) => {
      const demand = demandFrom(input.text);
      if (await ctx.sandbox.pathExists(".before-cache/agent-pollution")) {
        throw new Error("a private BeforeCache clone retained Agent/test writable state from an earlier Attempt");
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
          ? ctx.sandbox.readText(".before-cache/canonical-token")
          : Promise.resolve("not-requested"),
        ctx.sandbox.readText("/opt/niceeval-e2e/build-token"),
        ctx.sandbox.readText(".before-cache/fixture-token"),
        ctx.sandbox.readText(".before-cache/middle-token"),
        ctx.sandbox.readText(".before-cache/middle-version"),
        ctx.sandbox.readText(".before-cache/env-token"),
        ctx.sandbox.readText(".env"),
        ctx.sandbox.readText("fixture/input.txt"),
        ctx.sandbox.runShellOrThrow("cat /etc/hostname", { signal: ctx.signal }),
      ]);

      await ctx.sandbox.writeText(".before-cache/agent-pollution", `${demand}\n`);
      const evidence: BeforeCacheEvidence = {
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
          text: `before-cache-demand:${demand} before-cache-evidence:${encoded}`,
        }],
      };
  },
});
