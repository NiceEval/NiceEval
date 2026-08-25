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
  readonly outerWorkdirMarker: string;
  readonly actionSideEffectCount: number;
  readonly dockerDataPrefixMarker: string;
  readonly dockerDataPrefixSideEffectCount: number;
  readonly outerBarrierMarker: string;
  readonly barrierInnerMarker: string;
  readonly barrierInnerSideEffectCount: number;
  readonly suffixDockerDataMarker: string;
  readonly suffixDockerDataSideEffectCount: number;
  readonly agentPollutionBefore: number;
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
const dind = runtimeMode === "raw-dind" || runtimeMode === "profile-full-copy";
const profile = runtimeMode === "profile-full-copy";

const genericSandbox = sandboxLayer()
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
const sandbox = profile ? sandboxLayer() : genericSandbox;

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
    if (!profile && await ctx.sandbox.pathExists(".setup-prefix/agent-pollution")) {
      throw new Error("a private SetupPrefix clone retained Agent/test writable state from an earlier Attempt");
    }

    const profileVolumes = async (role: string): Promise<readonly string[]> => {
      if (!profile) return [];
      const result = await ctx.sandbox.runShellOrThrow(
        `docker volume ls --filter label=niceeval.e2e.setup-prefix-role=${role} --format '{{.Name}}'`,
        { signal: ctx.signal },
      );
      return result.stdout.split(/\r?\n/u).map((name) => name.trim()).filter(Boolean).sort();
    };

    const [
      dockerDataPrefixVolumes,
      barrierInnerVolumes,
      suffixDockerDataVolumes,
      pollutionVolumes,
    ] = await Promise.all([
      profileVolumes("docker-data-prefix"),
      profileVolumes("all-barrier"),
      profileVolumes("docker-data-suffix"),
      profileVolumes("agent-pollution"),
    ]);
    if (profile && (
      dockerDataPrefixVolumes.length !== 1 ||
      barrierInnerVolumes.length !== 1 ||
      suffixDockerDataVolumes.length !== 1
    )) {
      throw new Error(
        "Profile SetupPrefix must expose exactly one A prefix, one B barrier, and one C suffix Docker volume",
      );
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
      outerWorkdirMarker,
      actionSideEffectCount,
    ] = await Promise.all([
      ctx.sandbox.readText("/opt/niceeval-e2e/base-version"),
      runtimeMode === "canonical-json"
        ? ctx.sandbox.readText(".setup-prefix/canonical-token")
        : Promise.resolve("not-requested"),
      ctx.sandbox.readText("/opt/niceeval-e2e/build-token"),
      profile ? Promise.resolve("not-requested") : ctx.sandbox.readText(".setup-prefix/fixture-token"),
      profile ? Promise.resolve("not-requested") : ctx.sandbox.readText(".setup-prefix/env-token"),
      ctx.sandbox.readText(".env"),
      profile ? Promise.resolve("not-requested") : ctx.sandbox.readText("fixture/input.txt"),
      ctx.sandbox.runShellOrThrow("cat /etc/hostname", { signal: ctx.signal }),
      dind
        ? profile
          ? Promise.resolve(`volume:${dockerDataPrefixVolumes[0]}`)
          : ctx.sandbox.runShellOrThrow(
            "docker volume inspect niceeval-setup-prefix-inner-state --format 'volume:{{.Name}}'",
            { signal: ctx.signal },
          ).then((result) => result.stdout.trim())
        : Promise.resolve("not-requested"),
      dind
        ? ctx.sandbox.readText(".setup-prefix/outer-workdir-marker")
        : Promise.resolve("not-requested"),
      dind
        ? profile
          ? Promise.resolve(dockerDataPrefixVolumes.length)
          : ctx.sandbox.runShellOrThrow(
            "docker volume ls --filter label=niceeval.e2e.setup-prefix-action=stable --format '{{.Name}}' | wc -l",
            { signal: ctx.signal },
          ).then((result) => Number.parseInt(result.stdout.trim(), 10))
        : Promise.resolve(0),
    ]);

    if (profile) {
      const pollution = await ctx.sandbox.runShellOrThrow(
        "probe=$(node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())'); " +
          "docker volume create --label niceeval.e2e.setup-prefix-role=agent-pollution " +
          "\"niceeval-setup-prefix-agent-pollution-$probe\" >/dev/null",
        { signal: ctx.signal },
      );
      if (pollution.exitCode !== 0) throw new Error("failed to add Agent-owned inner Docker pollution");
    } else {
      await ctx.sandbox.writeText(".setup-prefix/agent-pollution", `${demand}\n`);
    }
    const evidence: SetupPrefixEvidence = {
      baseVersion: baseVersion.trim(),
      runtimeMode,
      innerDocker,
      outerWorkdirMarker: outerWorkdirMarker.trim(),
      actionSideEffectCount,
      dockerDataPrefixMarker: profile ? dockerDataPrefixVolumes[0]! : "not-requested",
      dockerDataPrefixSideEffectCount: dockerDataPrefixVolumes.length,
      outerBarrierMarker: profile ? outerWorkdirMarker.trim() : "not-requested",
      barrierInnerMarker: profile ? barrierInnerVolumes[0]! : "not-requested",
      barrierInnerSideEffectCount: barrierInnerVolumes.length,
      suffixDockerDataMarker: profile ? suffixDockerDataVolumes[0]! : "not-requested",
      suffixDockerDataSideEffectCount: suffixDockerDataVolumes.length,
      agentPollutionBefore: pollutionVolumes.length,
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
