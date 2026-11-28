import { Effect, Option } from "effect";
import fc from "fast-check";
import { completeEvidenceCoverage, defineSandboxAgent, openCodeAgent } from "niceeval/adapter";
import { SandboxCommandExitError, defineSandboxCommand, shell } from "niceeval/sandbox";
import { expect, test } from "vitest";
import { runAgentInstall } from "../../packages/niceeval/src/agents/provisioner.ts";
import type { AgentInstall, AgentInstaller } from "../../packages/niceeval/src/agents/types.ts";

const FIELDS = ["agent", "version", "revision"] as const;
type Field = (typeof FIELDS)[number];

const invalidValue = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom("", "   "),
  fc.integer(),
  fc.constant(null),
);
const validValue = fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,8}$/).filter((value) => value !== "latest");

const identityCase = fc
  .record({
    agent: fc.option(validValue, { nil: undefined }),
    version: fc.option(validValue, { nil: undefined }),
    revision: fc.option(validValue, { nil: undefined }),
    invalid: fc.tuple(invalidValue, invalidValue, invalidValue),
    extra: fc.dictionary(fc.constantFrom("fixture", "channel"), fc.string(), { maxKeys: 2 }),
  })
  .map(({ invalid, extra, ...valid }) => {
    const identity: Record<string, unknown> = { ...extra };
    const missing: Field[] = [];
    FIELDS.forEach((field, index) => {
      const value = valid[field];
      if (value !== undefined) identity[field] = value;
      else {
        missing.push(field);
        if (invalid[index] !== undefined) identity[field] = invalid[index];
      }
    });
    return { identity, missing };
  });

function defineWithIdentity(identity: Record<string, unknown>) {
  return defineSandboxAgent({
    name: "identity-probe",
    evidenceCoverage: completeEvidenceCoverage,
    install: { identity: identity as never, probe: shell("true") },
    async send() {
      return { status: "completed", events: [] };
    },
  });
}

// @feature docs/feature/adapters/architecture/agent-install.md
// Reduced regression from the issue: { fixture: "command-plan", revision: 1 } used to reach
// agent.install and fail on `undefined.trim` without naming the missing fields.
test("defineSandboxAgent names every missing install identity field when the module loads", () => {
  fc.assert(
    fc.property(identityCase, ({ identity, missing }) => {
      if (missing.length === 0) {
        expect(defineWithIdentity(identity).install[0]?.identity).toBe(identity);
        return;
      }
      let thrown: unknown;
      try {
        defineWithIdentity(identity);
      } catch (cause) {
        thrown = cause;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      const message = (thrown as TypeError).message;
      expect(message).not.toMatch(/reading 'trim'/u);
      for (const field of FIELDS) {
        expect(message.includes(`identity.${field}`), field).toBe(missing.includes(field));
      }
    }),
    {
      examples: [[{ identity: { fixture: "command-plan", revision: 1 }, missing: ["agent", "version", "revision"] }]],
    },
  );
});

type RepairOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "same-miss" }
  | { readonly kind: "other-miss"; readonly reason: string }
  | { readonly kind: "error"; readonly reason: string };

const reasonText = fc.stringMatching(/^[a-z][a-z0-9 ]{2,20}[a-z0-9]$/).filter((reason) => !reason.includes("fail"));
const repairOutcome: fc.Arbitrary<RepairOutcome> = fc.oneof(
  fc.constant({ kind: "absent" as const }),
  fc.constant({ kind: "same-miss" as const }),
  reasonText.map((reason) => ({ kind: "other-miss" as const, reason })),
  reasonText.map((reason) => ({ kind: "error" as const, reason })),
);

const unsupported = () => {
  throw new Error("Unexpected Sandbox operation");
};

function fakeSandbox() {
  return {
    sandboxId: "agent-install-fixture",
    workdir: "/workspace",
    runCommand: unsupported,
    runShell: unsupported,
    runCommandOrThrow: unsupported,
    runShellOrThrow: unsupported,
    readText: unsupported,
    writeText: unsupported,
    readBytes: unsupported,
    writeBytes: unsupported,
    pathExists: unsupported,
  } as never;
}

async function observeInstall(probeReason: string, repair: RepairOutcome): Promise<string[]> {
  const identity = { agent: "fixture-cli", version: "2.0.0", revision: "1" };
  let installed = false;
  const miss = (stderr: string) =>
    new SandboxCommandExitError({ stdout: "", stderr: `detail\n${stderr}\n`, exitCode: 1, command: "fixture --version" });
  const probe = defineSandboxCommand(
    { id: "test.agent-install.probe", revision: "1", inputs: {} },
    async () => {
      if (!installed) throw miss(probeReason);
    },
  );
  const install: AgentInstall = { identity, probe, progress: { checking: "checking fixture-cli 2.0.0" } };
  const installer: AgentInstaller = {
    identity,
    installMode: "sandbox-network",
    progress: { installing: "installing fixture-cli 2.0.0", repairing: "repairing fixture-cli 2.0.0" },
    ...(repair.kind === "absent"
      ? {}
      : {
          repair: async () => {
            if (repair.kind === "same-miss") throw miss(probeReason);
            if (repair.kind === "other-miss") throw miss(repair.reason);
            throw new Error(`stack line\n${repair.reason}`);
          },
        }),
    install: async (_sandbox, context) => {
      context.progress({ message: "fixture install step" });
      installed = true;
    },
  };
  const messages: string[] = [];
  const results = await Effect.runPromise(
    runAgentInstall([install], [installer], fakeSandbox(), {
      coordinator: Option.none(),
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      signal: new AbortController().signal,
      progress: ({ message }) => messages.push(message),
    }),
  );
  expect(results.map((result) => result.outcome)).toEqual(["installed"]);
  return messages;
}

// @feature docs/feature/adapters/architecture/agent-install.md
// Reduced regression from the issue: a repair that stops on the probe's own version miss used to
// show `repair failed: sandbox command exited ...` for the whole install.
test("a running install never presents the probe miss or repair result as a failure", async () => {
  await fc.assert(
    fc.asyncProperty(reasonText, repairOutcome, async (probeReason, repair) => {
      const messages = await observeInstall(probeReason, repair);
      const installing = messages.find((message) => message.startsWith("installing fixture-cli 2.0.0"));
      expect(installing).toBeDefined();
      for (const message of messages) expect(message).not.toMatch(/failed/u);
      expect(installing).toContain(`probe miss: ${probeReason}`);
      expect(installing!.split(probeReason).length - 1).toBe(1);
      const repairNote = installing!.match(/in-place repair unavailable: (.*)$/u)?.[1];
      if (repair.kind === "other-miss" || repair.kind === "error") {
        expect(repairNote).toBe(repair.reason === probeReason ? undefined : repair.reason);
      } else {
        expect(repairNote).toBeUndefined();
      }
      expect(messages.indexOf("fixture install step")).toBeGreaterThan(messages.indexOf(installing!));
      expect(messages.at(-1)).toMatch(/agent\.install installed/u);
    }),
    {
      numRuns: 40,
      examples: [["codex version mismatch: expected 0.167.2, actual 0.160.0.", { kind: "same-miss" }]],
    },
  );
});

// @feature docs/feature/adapters/architecture/agent-install.md
test("the built-in staged installer names the upload and unpack steps before each starts", async () => {
  const agent = openCodeAgent();
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
  const installer = agent.installers.find((candidate) => candidate.installMode === "staged");
  if (installer?.installMode !== "staged") throw new Error("Expected the staged installer");
  await fc.assert(
    fc.asyncProperty(fc.constantFrom("self-contained", "npm-tarball"), async (kind) => {
      const log: string[] = [];
      const ok = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });
      const sandbox = {
        ...(fakeSandbox() as object),
        runShell: async (script: string) => {
          if (script.includes("tar -xzf")) log.push("command:unpack");
          if (script.startsWith("npm install")) log.push("command:unpack");
          return ok(script.includes(`printf '%s' "$HOME"`) ? "/home/user" : "");
        },
        putContent: async () => {
          log.push("command:upload");
        },
      } as never;
      await installer.install(sandbox, {
        identity: installer.identity,
        targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
        signal: new AbortController().signal,
        progress: ({ message }) => log.push(`progress:${message}`),
        artifact: {
          platform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
          content: {} as never,
          targetPath: "$HOME/.niceeval-agent-payload/opencode.tgz",
          install: kind === "self-contained" ? { kind, binPath: "bin/opencode" } : { kind },
        },
      });
      const pinned = `opencode ${installer.identity.version}`;
      expect(log).toEqual([
        `progress:uploading the ${pinned} package into the Sandbox`,
        "command:upload",
        `progress:unpacking ${pinned} in the Sandbox`,
        "command:unpack",
      ]);
    }),
  );
});
