import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  sandboxLayer,
  shell,
  writeText,
} from "niceeval/sandbox";

interface SetupPrefixEvidence {
  readonly baseVersion: string;
  readonly runtimeMode: string;
  readonly innerDocker: string;
  readonly canonicalToken: string;
  readonly buildToken: string;
  readonly fixtureToken: string;
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
const rawDind = runtimeMode === "raw-dind";

const sandbox = sandboxLayer()
  .before(writeText({
    id: "public-env",
    path: ".env",
    text: publicEnv,
    changeFrequency: changeFrequency.frequent,
    dependsOn: [actionRef("fixture-execution-probe")],
  }))
  .before(shell({
    id: "env-execution-probe",
    command: [
      "set -eu",
      "grep -q '^PUBLIC_MODE=[a-z][a-z]*$' .env",
      "mkdir -p .setup-prefix",
      "node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())' > .setup-prefix/env-token",
    ].join("\n"),
    changeFrequency: changeFrequency.frequent + 10,
    dependsOn: [actionRef("public-env")],
  }));

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
  async send(input, ctx) {
    const demand = demandFrom(input.text);
    if (await ctx.sandbox.pathExists(".setup-prefix/agent-pollution")) {
      throw new Error("a private SetupPrefix clone retained Agent/test writable state from an earlier Attempt");
    }

    const [
      baseVersion,
      canonicalToken,
      buildToken,
      fixtureToken,
      envToken,
      publicEnv,
      fixture,
      hostname,
      innerDocker,
    ] = await Promise.all([
      ctx.sandbox.readText("/opt/niceeval-e2e/base-version"),
      runtimeMode === "canonical-json"
        ? ctx.sandbox.readText(".setup-prefix/canonical-token")
        : Promise.resolve("not-requested"),
      ctx.sandbox.readText("/opt/niceeval-e2e/build-token"),
      ctx.sandbox.readText(".setup-prefix/fixture-token"),
      ctx.sandbox.readText(".setup-prefix/env-token"),
      ctx.sandbox.readText(".env"),
      ctx.sandbox.readText("fixture/input.txt"),
      ctx.sandbox.runShellOrThrow("cat /etc/hostname", { signal: ctx.signal }),
      rawDind
        ? ctx.sandbox.runShellOrThrow(
            "docker volume inspect niceeval-setup-prefix-inner-state --format 'volume:{{.Name}}'",
            { signal: ctx.signal },
          ).then((result) => result.stdout.trim())
        : Promise.resolve("not-requested"),
    ]);

    await ctx.sandbox.writeText(".setup-prefix/agent-pollution", `${demand}\n`);
    const evidence: SetupPrefixEvidence = {
      baseVersion: baseVersion.trim(),
      runtimeMode,
      innerDocker,
      canonicalToken: canonicalToken.trim(),
      buildToken: buildToken.trim(),
      fixtureToken: fixtureToken.trim(),
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
