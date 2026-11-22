// 跨进程保证：外部程序与 Provider——真实 niceeval 进程经 Incus provider 准备、被杀与恢复时，实例、artifact 与诊断按 provider 请求日志结算
import { readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  RUNTIME_PROJECT,
  artifactConsumers,
  artifactDeletes,
  artifactPublishes,
  createIncusProject,
  readJournal,
  type IncusProject,
  type JournalRecord,
} from "../integration/fixtures/lifecycle-incus/project.ts";

const projects: IncusProject[] = [];
async function project(options: Parameters<typeof createIncusProject>[0] = {}) {
  const created = await createIncusProject({ artifactMaxInstances: 1, ...options });
  projects.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(projects.splice(0).map((created) => created.dispose()));
});

async function untilBlocked(journalPath: string, after: number): Promise<readonly JournalRecord[]> {
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; await sleep(50)) {
    const records = await readJournal(journalPath);
    if (records.slice(after).some((record) => record.event === "blocked")) return records;
  }
  throw new Error("the fake Incus never reached its blocking checkpoint");
}

/** Starts an Invocation, waits until the fake provider blocks on `request`, then SIGKILLs the whole process group. */
async function killAtProviderBoundary(created: IncusProject, request: string): Promise<readonly JournalRecord[]> {
  await rm(`${created.state}.block-claimed`, { force: true });
  const before = (await created.journal()).length;
  const child = created.start(["exp", "incus", "probe", "--rerun=all"], {
    NICEEVAL_E2E_FAKE_INCUS_BLOCK_ONCE: request,
  });
  try {
    const records = await untilBlocked(created.journalPath, before);
    process.kill(-child.pid!, "SIGKILL");
    expect((await child).signal).toBe("SIGKILL");
    return records;
  } finally {
    child.kill("SIGKILL");
  }
}

// The fake fails agent.install on purpose, so a prepared Attempt still exits non-zero; the property
// observes provider requests rather than the Attempt verdict.
const probe = ["exp", "incus", "probe", "--rerun=all"] as const;

describe("Incus snapshot takeover", () => {
  let created: IncusProject | undefined;
  let cold: readonly JournalRecord[];

  beforeAll(async () => {
    created = await createIncusProject({
      artifactMaxInstances: 1,
      artifactStorageReserveBytes: 1024 ** 3,
      artifactEstimatedBytes: 1024 ** 3,
    });
    await created.writeExperiment({ actionId: "takeover-prefix" });
    await created.niceeval(probe);
    cold = await created.journal();
  }, 60_000);

  afterAll(async () => {
    await created?.dispose();
  });

  // @feature docs/feature/sandbox/README.md#snapshot-takeover
  test("the first Invocation publishes and consumes one artifact", () => {
    expect(artifactPublishes(cold), JSON.stringify(cold)).toHaveLength(1);
    expect(artifactConsumers(cold)).toHaveLength(1);
  });

  // @feature docs/feature/sandbox/README.md#snapshot-takeover
  test("a later Invocation consumes the committed artifact without publishing again", async () => {
    const warmStart = (await created!.journal()).length;
    await created!.niceeval(probe);
    const warm = (await created!.journal()).slice(warmStart);
    expect(artifactPublishes(warm)).toHaveLength(0);
    expect(artifactConsumers(warm)).toHaveLength(1);
  }, 60_000);

  describe.for(["GET", "POST"] as const)("owner killed during %s /instances", (method) => {
    let crashedName: string | undefined;
    let recoveryStart: number;

    beforeAll(async () => {
      const crashed = await killAtProviderBoundary(created!, `${method} /1.0/instances?project=${RUNTIME_PROJECT}`);
      crashedName = [...crashed]
        .reverse()
        .find(
          ({ event, detail }) =>
            event === "query" &&
            detail.method === method &&
            detail.path === "/1.0/instances" &&
            detail.project === RUNTIME_PROJECT,
        )?.detail.body?.name;
      recoveryStart = (await created!.journal()).length;
    }, 60_000);

    // @feature docs/feature/sandbox/README.md#snapshot-takeover
    test("the successor consumes the committed artifact and removes any accepted instance", async () => {
      await created!.niceeval(probe);
      const recovery = (await created!.journal()).slice(recoveryStart);
      if (method === "POST") {
        expect(crashedName).toBeTruthy();
        expect(recovery, JSON.stringify(recovery)).toContainEqual(
          expect.objectContaining({
            event: "query",
            detail: expect.objectContaining({
              method: "DELETE",
              path: `/1.0/instances/${crashedName}`,
              project: RUNTIME_PROJECT,
            }),
          }),
        );
      }
      expect(artifactConsumers(recovery)).toHaveLength(1);
    }, 60_000);
  });
});

// @feature docs/feature/sandbox/README.md#preparation-failure
test("an exhausted cache pool degrades the prepared prefix to Base and still dispatches the Attempt", async () => {
  const created = await project({
    artifactStorageReserveBytes: 1024,
    artifactEstimatedBytes: 2048,
    state: { instances: {}, volumes: {}, storageResources: { space: { total: 4096, used: 4000 } } },
  });
  await created.writeExperiment({ actionId: "storage-prefix" });

  const doctor = await created.niceeval(["sandbox", "provider", "doctor", "incus", "--development"]);
  expect(doctor.exitCode, doctor.stdout).toBe(1);
  expect(doctor.stdout).toContain("Cache storage: FAIL");
  expect(doctor.stdout).toContain("4 free of 4");

  const refused = await created.niceeval(["exp", "incus", "probe", "--rerun=all", "--json"]);
  expect(refused.exitCode, refused.stderr).not.toBe(0);
  const documents = refused.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>);
  expect(documents.find((document) => document.type === "receipt")?.summary.beforeCaches).toEqual({
    total: 1,
    hit: 0,
    prepared: 0,
    degraded: 1,
    failed: 0,
  });
  expect(documents.filter((document) => document.event === "eval")).toEqual([
    expect.objectContaining({ evalId: "probe", verdict: "errored", locator: expect.any(String) }),
  ]);
  expect(await readFile(created.journalPath, "utf8")).not.toContain('"type":"copy"');
  expect(artifactDeletes(await created.journal())).toHaveLength(0);
}, 120_000);

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("a terminal provider failure keeps its diagnostic and the failed instance request is not repeated", async () => {
  const created = await project({ artifactStorageReserveBytes: 1024 ** 3, artifactEstimatedBytes: 1024 ** 3 });
  await created.writeExperiment({ actionId: "retry-prefix", bypassCache: true });
  await writeFile(`${created.state}.fail-next`, `POST /1.0/instances?project=${RUNTIME_PROJECT}\n`);

  const failed = await created.niceeval(probe);
  const output = `${failed.stdout}\n${failed.stderr}`;
  expect(failed.exitCode).not.toBe(0);
  expect(output).toContain("Incus POST /1.0/instances?project=niceeval-eval-dev failed (exit 1): Error: Failed");
  expect(output).toContain("creating instance: storage pool capacity exhausted");
  expect(output).not.toContain("unexpected JSON shape");

  // The fake consumes its one-shot failure on first contact, so any repeat of the request would succeed
  // and appear as a later runtime POST.
  const records = await created.journal();
  const failedAt = records.findIndex((record) => record.event === "failed");
  expect(failedAt, JSON.stringify(records)).toBeGreaterThanOrEqual(0);
  expect(
    records
      .slice(failedAt + 1)
      .filter(
        (record) =>
          record.event === "query" &&
          record.detail.method === "POST" &&
          record.detail.path === "/1.0/instances" &&
          record.detail.project === RUNTIME_PROJECT,
      ),
    JSON.stringify(records),
  ).toEqual([]);
}, 120_000);
