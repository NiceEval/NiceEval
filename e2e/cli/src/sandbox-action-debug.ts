import { appendFileSync } from "node:fs";
import { Schema } from "effect";
import {
  defineSandboxAction,
  sandboxStep,
  actionRef,
  defineSandboxCommand,
  command,
  writeText,
} from "niceeval/sandbox";

export const SANDBOX_ACTION_DEBUG_SIDE_EFFECTS = "sandbox-action-debug-side-effects.ndjson";

export const SANDBOX_ACTION_DEBUG_ENV_KEY = "NICEEVAL_DEBUG_PRIVATE_TOKEN";
export const SANDBOX_ACTION_DEBUG_ENV_VALUE = "debug-env-value-must-not-leak-91f65d";
export const SANDBOX_ACTION_DEBUG_STDIN = "debug-stdin-must-not-leak-4a360c\n";

export function recordSandboxActionDebugSideEffect(kind: string): void {
  appendFileSync(
    SANDBOX_ACTION_DEBUG_SIDE_EFFECTS,
    `${JSON.stringify({ kind })}\n`,
    "utf8",
  );
}

const debugAction = defineSandboxAction({
  id: "@niceeval/e2e-cli/sandbox-action-debug",
  input: Schema.Struct({ marker: Schema.String }),
  cache: {
    fingerprint: ({ marker }) => ({
      fixtureProtocol: "sandbox-action-debug/v1",
      marker,
    }),
  },
  steps: ({ marker }) => [
    sandboxStep.exec({
      executable: "printf",
      args: ["%s", marker],
    }),
    sandboxStep.putText({
      path: `.debug-plan/${marker}.txt`,
      text: marker,
    }),
  ] as const,
});

function prototypeSafeFingerprintAction(fingerprint: unknown) {
  return defineSandboxAction({
    id: "@niceeval/e2e-cli/prototype-safe-fingerprint",
    input: Schema.Struct({ marker: Schema.String }),
    cache: { fingerprint },
    steps: ({ marker }) => [
      sandboxStep.exec({
        executable: "printf",
        args: ["%s", marker],
      }),
    ] as const,
  });
}

const sharedPrototypeFingerprintInput = { marker: "prototype-safe-fingerprint" };

export const prototypeFingerprintAlpha = prototypeSafeFingerprintAction(
  JSON.parse('{"__proto__":{"revision":"alpha"},"constructor":{"revision":"shared"}}'),
)(sharedPrototypeFingerprintInput, {
  id: "fingerprint-prototype-alpha",
  changeFrequency: 20,
});

export const prototypeFingerprintBeta = prototypeSafeFingerprintAction(
  JSON.parse('{"__proto__":{"revision":"beta"},"constructor":{"revision":"shared"}}'),
)(sharedPrototypeFingerprintInput, {
  id: "fingerprint-prototype-beta",
  changeFrequency: 20,
});

export const constructorFingerprintBeta = prototypeSafeFingerprintAction(
  JSON.parse('{"__proto__":{"revision":"alpha"},"constructor":{"revision":"beta"}}'),
)(sharedPrototypeFingerprintInput, {
  id: "fingerprint-constructor-beta",
  changeFrequency: 20,
});

export const builtinFingerprintAlpha = writeText({
  id: "builtin-fingerprint-alpha",
  path: ".debug-plan/builtin-fingerprint.txt",
  text: "same automatic fingerprint",
  changeFrequency: 20,
  cache: { fingerprint: { fixtureRevision: "alpha" } },
});

export const builtinFingerprintBeta = writeText({
  id: "builtin-fingerprint-beta",
  path: ".debug-plan/builtin-fingerprint.txt",
  text: "same automatic fingerprint",
  changeFrequency: 20,
  cache: { fingerprint: { fixtureRevision: "beta" } },
});

export function plannedDebugAction(
  id: string,
  changeFrequency: number,
  dependsOn: readonly string[] = [],
) {
  return debugAction(
    { marker: id },
    {
      id,
      changeFrequency,
      ...(dependsOn.length === 0
        ? {}
        : { dependsOn: dependsOn.map((dependency) => actionRef(dependency)) }),
    },
  );
}

/** Official command Action exercises the public plan's redacted env/stdin identity. */
export const sensitiveDebugCommand = command("sh", ["-c", "cat >/dev/null"], {
  id: "sensitive-command",
  changeFrequency: 150,
  env: { [SANDBOX_ACTION_DEBUG_ENV_KEY]: SANDBOX_ACTION_DEBUG_ENV_VALUE },
  stdin: SANDBOX_ACTION_DEBUG_STDIN,
});

export const opaqueDebugBarrier = defineSandboxCommand(
  {
    id: "opaque-barrier",
    revision: "1",
    inputs: { fixture: "sandbox-action-debug" },
    changeFrequency: 200,
  },
  async () => {
    recordSandboxActionDebugSideEffect("legacy-command");
  },
);

export const sandboxActionDebugAgentProbe = defineSandboxCommand(
  {
    id: "debug-agent-probe",
    revision: "1",
    inputs: { fixture: "sandbox-action-debug-agent-probe" },
  },
  async (sandbox) => {
    recordSandboxActionDebugSideEffect("agent-probe");
    const result = await sandbox.runShell("true");
    if (result.exitCode !== 0) throw new Error("sandbox action debug Agent probe failed");
  },
);
