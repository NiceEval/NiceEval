// 跨进程保证：外部程序与 Provider——真实 CLI 通过 Incus 可执行程序准备、失败和消费快照
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";
import {
  ARTIFACT_PROJECT,
  artifactConsumers,
  artifactPublishes,
  createIncusProject,
  type IncusProject,
  RUNTIME_PROJECT,
} from "../integration/fixtures/lifecycle-incus/project.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { decodeExpPrepareEvent, decodeExpTerminalEvent } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");

const args = ["exp", "incus", "probe", "--rerun=all", "--json"] as const;

async function observe(project: IncusProject, env?: NodeJS.ProcessEnv) {
  const result = await project.niceeval(args, env);
  // This fixture's Agent fails its install probe after Sandbox preparation.
  expect(result.exitCode, result.stderr || result.stdout).toBe(1);
  const lines = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const receipt = lines.find((line) => line.type === "receipt");
  expect(receipt, result.stderr || result.stdout).toBeDefined();
  const terminal = decodeExpTerminalEvent(receipt);
  const settlements = lines
    .filter((line) => line.event === "prepare")
    .map(decodeExpPrepareEvent)
    .filter((event) => event.phase === "settled")
    .map(({ action, outcome, reason }) => ({ id: action.id, outcome, reason }));
  return { summary: terminal.summary, settlements };
}

const faultCases = ["staging", "capture", "action"] as const;
type Fault = (typeof faultCases)[number];
const preparationInputs = fc.sample(fc.integer({ min: 1, max: 10_000 }), { seed: 260_603, numRuns: faultCases.length });
const oldLedger = new URL("../../e2e/cli/fixtures/old-user-database/niceeval.sqlite", import.meta.url);

async function observeFault(fault: Fault, actionId: string) {
  const project = await createIncusProject({ artifactStorageReserveBytes: 1024 ** 3, artifactEstimatedBytes: 1024 ** 3 });
  try {
    await project.writeExperiment({ actionId });
    if (fault === "action") {
      const experiment = join(project.cwd, "experiments", "incus.ts");
      const source = await readFile(experiment, "utf8");
      // The protocol fixture returns a failure for this author command.
      await writeFile(experiment, source.replace('command: "true"', 'command: "node --version"'));
    } else {
      const target = fault === "staging" ? RUNTIME_PROJECT : ARTIFACT_PROJECT;
      await writeFile(`${project.state}.fail-next`, `POST /1.0/instances?project=${target}\n`);
    }
    return { fault, actionId, ...(await observe(project)), journal: await project.journal() };
  } finally {
    await project.dispose();
  }
}

describe("Incus fault settlement", () => {
  let preparation: Awaited<ReturnType<typeof observeFault>>[];
  beforeAll(async () => {
    // The receipt and provider-resource rules below share these isolated Invocations.
    preparation = [];
    for (const [index, fault] of faultCases.entries()) {
      preparation.push(await observeFault(fault, `prepare-${preparationInputs[index]}`));
    }
  }, 60_000);

  // @feature docs/feature/sandbox/README.md#preparation-failure
  test("Incus settles each preparation fault by cause", () => {
    const reasons = { staging: "staging-failed", capture: "snapshot-uncertain", action: "action-failed" };
    for (const { fault, actionId, summary, settlements } of preparation) {
      const actionFailed = fault === "action";
      expect(summary.beforeCaches, fault).toEqual({
        total: 1, hit: 0, prepared: 0, degraded: actionFailed ? 0 : 1, failed: actionFailed ? 1 : 0,
      });
      expect(summary.errored, fault).toBe(1);
      expect(settlements, fault).toEqual([
        { id: actionId, outcome: actionFailed ? "failed" : "degraded", reason: reasons[fault] },
      ]);
    }
  });

  // @feature docs/feature/sandbox/README.md#preparation-failure
  test("Incus preparation faults leave no artifact to consume", () => {
    for (const { fault, journal } of preparation) {
      expect(artifactPublishes(journal), fault).toHaveLength(fault === "capture" ? 1 : 0);
      expect(artifactConsumers(journal), fault).toEqual([]);
    }
  });
});

// @feature docs/feature/sandbox/README.md#user-database-format
test("Incus refuses a historical UserDatabase without changing its bytes or creating provider resources", async () => {
  const project = await createIncusProject({});
  try {
    await project.writeExperiment({ actionId: "historical-ledger" });
    const home = project.env.NICEEVAL_HOME!;
    const database = join(home, "niceeval.sqlite");
    const original = await readFile(oldLedger);
    await mkdir(home);
    await writeFile(database, original);

    const result = await project.niceeval(["sandbox", "provider", "inventory", "incus", "--development", "--json"]);
    expect(result.exitCode, result.stderr || result.stdout).toBe(4);
    expect(`${result.stderr}\n${result.stdout}`).toContain(database);
    expect(`${result.stderr}\n${result.stdout}`).toContain("written by an older NiceEval");
    expect(await readFile(database)).toEqual(original);
    expect((await project.journal()).filter(({ detail }) => detail.method === "POST")).toEqual([]);
  } finally {
    await project.dispose();
  }
}, 20_000);

describe("Incus snapshot publication", () => {
  beforeAll(async () => {
    const options = { artifactStorageReserveBytes: 1024 ** 3, artifactEstimatedBytes: 1024 ** 3 };
    const projects: IncusProject[] = [];
    try {
      const first = await createIncusProject(options);
      projects.push(first);
      const second = await createIncusProject(options);
      projects.push(second);
      const [suffix] = fc.sample(fc.nat(), { seed: 260_605, numRuns: 1 });
      const actionId = `shared-prefix-${suffix}`;
      await Promise.all(projects.map((project) => project.writeExperiment({ actionId })));
      // Two project Records share the same local artifact ledger and provider.
      const shared = {
        NICEEVAL_HOME: first.env.NICEEVAL_HOME,
        NICEEVAL_E2E_FAKE_INCUS_STATE: first.state,
        NICEEVAL_E2E_FAKE_INCUS_JOURNAL: first.journalPath,
      };
      const results = await Promise.allSettled(projects.map((project) => observe(project, shared)));
      observations = results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      journal = await first.journal();
    } finally {
      await Promise.all(projects.map((project) => project.dispose()));
    }
  }, 60_000);

  let observations: Awaited<ReturnType<typeof observe>>[];
  let journal: Awaited<ReturnType<IncusProject["journal"]>>;

  // @feature docs/feature/sandbox/README.md#snapshot-takeover
  test("concurrent Incus Invocations publish one shared snapshot and both consume it", () => {
    expect(artifactPublishes(journal)).toHaveLength(1);
    expect(artifactConsumers(journal)).toHaveLength(2);
    for (const { summary, settlements } of observations) {
      expect(summary.beforeCaches).toMatchObject({ total: 1, degraded: 0, failed: 0 });
      expect(settlements).toEqual([expect.objectContaining({ outcome: expect.stringMatching(/^(?:hit|published)$/u) })]);
    }
  });
});

async function loseFirstCreateResponse(project: IncusProject) {
  const launcher = join(project.runtime, "bin", "incus");
  const original = await readFile(launcher, "utf8");
  const wrapped = `${launcher}-original`;
  await writeFile(wrapped, original, { mode: 0o755 });
  await writeFile(launcher, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const target = ${JSON.stringify(`/1.0/instances?project=${RUNTIME_PROJECT}`)};
const isCreate = args[0] === "query" && args.includes("POST") && args.includes(target);
const result = spawnSync(${JSON.stringify(wrapped)}, args, { encoding: "utf8" });
if (isCreate && result.status === 0) {
  // The fake accepted the create. Lose its response once, then expose the original provider again.
  writeFileSync(${JSON.stringify(launcher)}, ${JSON.stringify(original)});
  process.stderr.write("connection reset after request acceptance\\n");
  process.exit(1);
}
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
`);
}

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("Incus destroys a possibly accepted instance before retrying its create", async () => {
  const project = await createIncusProject({ artifactStorageReserveBytes: 1024 ** 3, artifactEstimatedBytes: 1024 ** 3 });
  try {
    await project.writeExperiment({ actionId: "retry-ambiguous-create", bypassCache: true });
    await loseFirstCreateResponse(project);
    const { summary } = await observe(project);
    expect(summary.errored).toBe(1); // The fixture Agent install fails after the successful retry.
    const journal = await project.journal();
    const creates = journal.flatMap(({ detail }, index) =>
      detail.project === RUNTIME_PROJECT && detail.method === "POST" && detail.path === "/1.0/instances"
        ? [{ name: detail.body?.name, index }]
        : [],
    );
    expect(creates, JSON.stringify(journal)).toHaveLength(2);
    const [first, retry] = creates;
    expect(first!.name).toEqual(expect.any(String));
    expect(retry!.name).toEqual(expect.any(String));
    expect(journal.slice(first!.index + 1, retry!.index).filter(({ detail }) => detail.method === "DELETE")).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({ path: `/1.0/instances/${first!.name}`, project: RUNTIME_PROJECT }),
      }),
    );
  } finally {
    await project.dispose();
  }
}, 25_000);
