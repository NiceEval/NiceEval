import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import fc from "fast-check";
import { withInspectionQuery } from "niceeval/inspection/host";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createLifecycleProject, runCli, showAttempt } from "./fixtures/lifecycle-sandbox/harness.ts";

const outcomes = [
  "hit",
  "repaired",
  "installed",
  "repair-fallback",
  "repair-recheck-miss",
  "same-miss",
  "redacted",
] as const;
type Outcome = (typeof outcomes)[number];
const probeMissReason = "fixture executable is missing";
const repairFailureReason = "fixture install link is unavailable";
const recheckMissReason = "fixture executable still has the wrong version";

function expectedFacts(sequence: readonly Outcome[]) {
  return sequence.map((outcome, index) => {
    const identity = { agent: `fixture-${index}`, version: "2.0.0", revision: "3" };
    switch (outcome) {
      case "hit":
        return { outcome, identity };
      case "repaired":
        return { outcome, identity, probeMissReason };
      case "installed":
        return { outcome, identity, probeMissReason };
      case "repair-fallback":
        return { outcome: "installed", identity, probeMissReason, repairFailureReason };
      case "repair-recheck-miss":
        return { outcome: "installed", identity, probeMissReason, repairFailureReason: recheckMissReason };
      case "same-miss":
        return { outcome: "installed", identity, probeMissReason, repairFailureReason: probeMissReason };
      case "redacted":
        return { outcome: "installed", identity, probeMissReason: "fixture token <redacted>" };
    }
  });
}

async function installFixture(cwd: string, sequence: readonly Outcome[], failAfter: boolean) {
  const path = join(cwd, "agent.ts");
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source
      .replace(
        'import { shell } from "niceeval/sandbox";',
        'import { defineSandboxCommand, SandboxCommandExitError } from "niceeval/sandbox";',
      )
      .replace(
        "export default defineSandboxAgent",
        String.raw`
const scenarios = ${JSON.stringify(failAfter ? [...sequence, "verify-only"] : sequence)};
const exit = (stderr) => new SandboxCommandExitError({
  stdout: "", stderr: "earlier output\n\x1b[31m" + stderr + "\x1b[0m\n\n", exitCode: 7, command: "fixture --version",
});
const fixtures = scenarios.map((scenario, index) => {
  const identity = { agent: "fixture-" + index, version: "2.0.0", revision: "3" };
  let ready = scenario === "hit";
  let repaired = false;
  const probe = defineSandboxCommand(
    { id: "fixture.install-probe-" + index, revision: "1", inputs: {} },
    async (sandbox) => {
      if (ready) return;
      if (scenario === "redacted") {
        const secret = "fixture-secret".repeat(18);
        await sandbox.runCommand("true", [], { sensitiveValues: [secret] });
        throw exit("fixture token " + secret);
      }
      throw exit(repaired ? ${JSON.stringify(recheckMissReason)} : ${JSON.stringify(probeMissReason)});
    },
  );
  const repair = async () => {
    if (scenario === "repair-fallback") throw new Error("earlier output\n" + ${JSON.stringify(repairFailureReason)});
    if (scenario === "same-miss") throw exit(${JSON.stringify(probeMissReason)});
    repaired = true;
    ready = scenario === "repaired";
  };
  const installer = scenario === "verify-only"
    ? { identity, installMode: "verify-only" }
    : {
        identity,
        installMode: "sandbox-network",
        install: async () => { ready = true; },
        ...(scenario === "installed" || scenario === "redacted" ? {} : { repair }),
      };
  return { install: { identity, probe }, installer };
});
export default defineSandboxAgent`,
      )
      .replace(
        /^  install: .*$/mu,
        "  install: fixtures.map(({ install }) => install),\n  installers: fixtures.map(({ installer }) => installer),",
      ),
  );
}

async function runInstall(sequence: readonly Outcome[], failAfter = false) {
  const project = await createLifecycleProject({
    scripts: [{ cleanups: 0, beforeFails: false, test: "pass" }],
    attempts: 1,
    maxConcurrency: 1,
    failCreates: [],
  });
  try {
    await installFixture(project.cwd, sequence, failAfter);
    const { attempts } = await project.run();
    expect(attempts).toHaveLength(1);
    const { locator } = attempts[0]!;
    return { project, locator };
  } catch (error) {
    await project.dispose();
    throw error;
  }
}

const unavailable = { state: "unavailable", reason: "not-recorded" };
const recorded = (sequence: readonly Outcome[]) => ({ state: "available", value: expectedFacts(sequence) });

describe("a sealed Attempt with successful install declarations", () => {
  const [sequence = []] = fc.sample(fc.shuffledSubarray([...outcomes], { minLength: outcomes.length }), {
    seed: 882097523,
    numRuns: 1,
  });
  let fixture: Awaited<ReturnType<typeof runInstall>>;
  beforeAll(async () => {
    fixture = await runInstall(sequence);
  });
  afterAll(async () => fixture?.project.dispose());

  // @feature docs/feature/adapters/README.md#attempt-install-readback
  test("Inspection preserves declaration order, outcomes, identity, and bounded reasons", async () => {
    const { project, locator } = fixture;
    const { attempt } = await withInspectionQuery({ cwd: project.cwd }, (query) =>
      query.inspect({ kind: "attempt.get", locator }),
    );
    expect(attempt.verdict).toBe("passed");
    expect(attempt.agentInstall, sequence.join(", ")).toEqual(recorded(sequence));
  });

  // @feature docs/feature/adapters/README.md#attempt-install-readback
  test("Show JSON preserves the same installation facts", async () => {
    const { project, locator } = fixture;
    const attempt = await showAttempt(project.cwd, locator);
    expect(attempt.agentInstall, sequence.join(", ")).toEqual(recorded(sequence));
  });

  // @feature docs/feature/adapters/README.md#attempt-install-readback
  test("Show text displays the identity and both reasons for repair fallback", async () => {
    const { project, locator } = fixture;
    const output = await runCli(project.cwd, ["show", locator]);
    expect(output.code, output.stderr).toBe(0);
    expect(output.stdout).toContain("Agent install");
    expect(output.stdout).toContain(`fixture-${sequence.indexOf("repair-fallback")}@2.0.0`);
    expect(output.stdout).toContain(probeMissReason);
    expect(output.stdout).toContain(repairFailureReason);
  });
});

describe.each([
  { name: "one declaration completed", sequence: ["same-miss"] as const },
  { name: "no declaration completed", sequence: [] as const },
])("an install failure when $name", ({ sequence }) => {
  let fixture: Awaited<ReturnType<typeof runInstall>>;
  beforeAll(async () => {
    fixture = await runInstall(sequence, true);
  });
  afterAll(async () => fixture?.project.dispose());

  // @feature docs/feature/adapters/README.md#attempt-install-readback
  test("Inspection reports the completed installation facts", async () => {
    const { project, locator } = fixture;
    const { attempt } = await withInspectionQuery({ cwd: project.cwd }, (query) =>
      query.inspect({ kind: "attempt.get", locator }),
    );
    expect(attempt.verdict).toBe("errored");
    expect(attempt.agentInstall).toEqual(sequence.length === 0 ? unavailable : recorded(sequence));
  });
});

describe("a same-format historical Record", () => {
  let cwd: string | undefined;
  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "niceeval-historical-agent-install-"));
    const fixture = await readFile(
      new URL("fixtures/execution-trace-navigation/record-3-without-index.sqlite.gz", import.meta.url),
    );
    const directory = join(cwd, ".niceeval");
    await mkdir(directory);
    await writeFile(join(directory, "record.sqlite"), gunzipSync(fixture));
  });
  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { force: true, recursive: true });
  });

  // @feature docs/feature/adapters/README.md#attempt-install-readback
  test("Inspection reads an Attempt written before Agent install publication as not-recorded", async () => {
    if (cwd === undefined) throw new Error("Historical project was not prepared");
    const { attempt } = await withInspectionQuery({ cwd }, (query) =>
      query.inspect({ kind: "attempt.get", locator: "@1TFHGJDDX8MF7" }),
    );
    expect(attempt.agentInstall).toEqual(unavailable);
  });
});
