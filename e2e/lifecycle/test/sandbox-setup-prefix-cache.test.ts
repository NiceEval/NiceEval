// owner: docs/engineering/testing/e2e/README.md#sandbox-setup-prefix-cache
// rerun: pnpm e2e test --repo lifecycle -- --run test/sandbox-setup-prefix-cache.test.ts

import { randomUUID } from "node:crypto";
import { appendFile, copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { command, only, pollUntil, withProcess, withProjectCopy, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";

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

interface HostFixture {
  readonly assets: string;
  readonly controlSocket: string;
  readonly descriptor: string;
  readonly hostConfig: string;
  readonly journal: string;
  readonly profileId: string;
  readonly readyFile: string;
}

type JsonRecord = Record<string, unknown>;

interface DebugPlanDocument {
  readonly format: "niceeval.debug-plan/v1";
  readonly commandPlan: unknown;
}

interface SetupPrefixLedgerEvent {
  readonly event: string;
  readonly setupPrefixKey?: string;
  readonly reason?: string;
}

interface SetupPrefixHostObservation {
  readonly settled: boolean;
  readonly leases: readonly JsonRecord[];
  readonly reservations: readonly JsonRecord[];
  readonly queue: readonly unknown[];
  readonly slots: readonly JsonRecord[];
  readonly operations: readonly JsonRecord[];
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const docker = command(["docker"]);
const sudo = command(["sudo", "-n"]);
const binary = resolve("node_modules/.bin/niceeval");
const nodeImage = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const dindImage = "docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c";
const buildkitImage = "moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8";
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-setup-prefix-project-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

function decodeEvidence(stdout: string): SetupPrefixEvidence {
  const encoded = new Set(
    [...stdout.matchAll(/setup-prefix-evidence:([A-Za-z0-9_-]+)/gu)].map((match) => match[1]!),
  );
  expect(encoded.size, "public execution view must expose exactly one Agent evidence payload").toBe(1);
  const value = JSON.parse(Buffer.from([...encoded][0]!, "base64url").toString("utf8")) as Partial<SetupPrefixEvidence>;
  for (const key of [
    "baseVersion",
    "runtimeMode",
    "innerDocker",
    "outerWorkdirMarker",
    "dockerDataPrefixMarker",
    "outerBarrierMarker",
    "barrierInnerMarker",
    "suffixDockerDataMarker",
    "canonicalToken",
    "buildToken",
    "fixtureToken",
    "envToken",
    "publicEnv",
    "fixture",
    "demand",
    "sandboxId",
  ] as const) {
    expect(value[key], `${key} must be a non-empty public evidence string`).toEqual(expect.any(String));
    expect(value[key]!.length, `${key} must be non-empty`).toBeGreaterThan(0);
  }
  for (const key of [
    "actionSideEffectCount",
    "dockerDataPrefixSideEffectCount",
    "barrierInnerSideEffectCount",
    "suffixDockerDataSideEffectCount",
    "agentPollutionBefore",
  ] as const) {
    expect(value[key], `${key} must be a non-negative public evidence integer`).toEqual(expect.any(Number));
    expect(Number.isSafeInteger(value[key])).toBe(true);
    expect(value[key]).toBeGreaterThanOrEqual(0);
  }
  return value as SetupPrefixEvidence;
}

async function waitForSandboxGone(sandboxId: string, cwd: string): Promise<void> {
  await pollUntil(
    async () => {
      const inspected = await docker.run(["inspect", sandboxId], { cwd });
      return inspected.exitCode !== 0 ? true : undefined;
    },
    { timeoutMs: 15_000, intervalMs: 100, label: `private SetupPrefix clone ${sandboxId} to be removed` },
  );
}

async function profileRuntimeResources(profileId: string): Promise<readonly string[]> {
  const filters = ["--quiet", "--filter", `label=niceeval.profile-id=${profileId}`];
  const [containers, networks] = await Promise.all([
    docker.run(["ps", "--all", ...filters]),
    docker.run(["network", "ls", ...filters]),
  ]);
  expect(containers.exitCode, containers.diagnostic()).toBe(0);
  expect(networks.exitCode, networks.diagnostic()).toBe(0);
  return [containers.stdout, networks.stdout]
    .flatMap((value) => value.split(/\r?\n/u))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function containersForInvocation(pid: number, cwd: string): Promise<readonly string[]> {
  const result = await docker.run([
    "ps", "-a", "--filter", `label=niceeval.pid=${pid}`, "--format", "{{.ID}}",
  ], { cwd });
  expect(result.exitCode, result.diagnostic()).toBe(0);
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

async function fileExists(path: string): Promise<true | undefined> {
  try {
    await readFile(path);
    return true;
  } catch {
    return undefined;
  }
}

async function readFixtureHostFile(path: string): Promise<string> {
  const result = await sudo.run([
    "python3", "-c",
    "from pathlib import Path; import sys; sys.stdout.write(Path(sys.argv[1]).read_text(encoding='utf-8'))",
    path,
  ]);
  expect(result.exitCode, result.diagnostic()).toBe(0);
  return result.stdout;
}

async function setupPrefixLedgerEvents(path: string): Promise<readonly SetupPrefixLedgerEvent[]> {
  const raw = await readFixtureHostFile(path);
  return Object.freeze(raw.split(/\r?\n/u).flatMap((line): SetupPrefixLedgerEvent[] => {
    if (line.trim() === "") return [];
    const value = JSON.parse(line) as JsonRecord;
    if (typeof value.event !== "string" || !value.event.startsWith("setup-prefix-")) return [];
    const detail = isRecord(value.detail) ? value.detail : {};
    return [{
      event: value.event,
      ...(typeof detail.setupPrefixKey === "string" ? { setupPrefixKey: detail.setupPrefixKey } : {}),
      ...(typeof detail.reason === "string" ? { reason: detail.reason } : {}),
    }];
  }));
}

async function setupPrefixHostObservation(path: string): Promise<SetupPrefixHostObservation> {
  const lines = (await readFixtureHostFile(path)).trim().split(/\r?\n/u);
  const latest = JSON.parse(lines.at(-1) ?? "{}") as JsonRecord;
  const state = isRecord(latest.state) ? latest.state : {};
  const setupPrefix = isRecord(state.setupPrefix) ? state.setupPrefix : {};
  const operations = isRecord(setupPrefix.operations) ? setupPrefix.operations : {};
  const leases = isRecord(state.leases) ? state.leases : {};
  const reservations = isRecord(state.reservations) ? state.reservations : {};
  const slots = isRecord(state.slots) ? state.slots : {};
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const leaseSummary = Object.values(leases).filter(isRecord).map((lease) => ({
    invocationId: lease.invocationId,
    state: lease.state,
  }));
  const reservationSummary = Object.values(reservations).filter(isRecord).map((reservation) => ({
    reservationId: reservation.reservationId,
    invocationId: reservation.invocationId,
    state: reservation.state,
    slotId: reservation.slotId,
    setupPrefixOperation: reservation.setupPrefixOperation,
  }));
  const slotSummary = Object.values(slots).filter(isRecord).map((slot) => ({
    slotId: slot.slotId,
    state: slot.state,
    reservationId: slot.reservationId,
  }));
  const operationSummary = Object.values(operations).filter(isRecord).map((operation) => ({
    operationId: operation.operationId,
    kind: operation.kind,
    state: operation.state,
    reservationId: operation.reservationId,
    slotId: operation.slotId,
    setupPrefixKey: operation.setupPrefixKey,
  }));
  const settled = leaseSummary.length === 0 &&
    reservationSummary.length === 0 &&
    queue.length === 0 &&
    operationSummary.length === 0 &&
    slotSummary.length > 0 &&
    slotSummary.every((slot) => slot.state === "free" && slot.reservationId === undefined);
  return Object.freeze({
    settled,
    leases: Object.freeze(leaseSummary),
    reservations: Object.freeze(reservationSummary),
    queue: Object.freeze([...queue]),
    slots: Object.freeze(slotSummary),
    operations: Object.freeze(operationSummary),
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordsInPlan(value: unknown, records: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) recordsInPlan(item, records);
    return records;
  }
  if (!isRecord(value)) return records;
  records.push(value);
  for (const item of Object.values(value)) recordsInPlan(item, records);
  return records;
}

function profileRegistrySetup(fixture: HostFixture, profile: string, hostRoot: string): string {
  return `mkdir -p /etc/niceeval/docker-profiles '${join(hostRoot, "state")}'
cp '${fixture.descriptor}' '/etc/niceeval/docker-profiles/${profile}.json'
cp '${fixture.assets}' /etc/niceeval/docker-profiles/assets-v1.json
chown root:root '/etc/niceeval/docker-profiles/${profile}.json' /etc/niceeval/docker-profiles/assets-v1.json
chmod 600 '/etc/niceeval/docker-profiles/${profile}.json'
chmod 644 /etc/niceeval/docker-profiles/assets-v1.json`;
}

async function debugProfileSetupPrefix(
  root: string,
  hostRoot: string,
  fixture: HostFixture,
  profile: string,
  stateVariant: "all" | "dockerData" = "dockerData",
  projectSourceRoot: string = root,
): Promise<Readonly<Record<"prefix" | "barrier" | "suffix", JsonRecord>>> {
  const driver = await docker.run([
    "run", "--rm", "--network", "none", "--user", "0:0",
    "--mount", `type=bind,src=${process.cwd()},dst=${process.cwd()},readonly`,
    "--mount", `type=bind,src=${projectSourceRoot},dst=${root}`,
    "--mount", `type=bind,src=${hostRoot},dst=${hostRoot}`,
    "--mount", "type=bind,src=/run/docker.sock,dst=/run/docker.sock",
    "--workdir", root,
    "--env", `NICEEVAL_E2E_DOCKER_PROFILE_ALIAS=${profile}`,
    "--env", "NICEEVAL_E2E_SETUP_PREFIX_MODE=profile-full-copy",
    "--env", "NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV=PUBLIC_MODE=alpha\n",
    "--env", `NICEEVAL_E2E_SETUP_PREFIX_STATE_VARIANT=${stateVariant}`,
    "--env", `XDG_STATE_HOME=${join(hostRoot, "state")}`,
    nodeImage,
    "sh", "-ec",
    `${profileRegistrySetup(fixture, profile, hostRoot)}
exec node_modules/.bin/niceeval debug setup-prefix-cache setup-prefix-cache --json`,
  ], { cwd: root, timeoutMs: 30_000 });
  expect(
    driver.exitCode,
    `Profile invocation failed; final public output:\n${driver.stdout.slice(-16_000)}\n${driver.stderr}`,
  ).toBe(0);
  const document = driver.json<DebugPlanDocument>();
  expect(document.format).toBe("niceeval.debug-plan/v1");
  const actionNode = (id: string): JsonRecord => {
    const nodes = recordsInPlan(document.commandPlan).filter((node) => {
      const action = isRecord(node.action) ? node.action : undefined;
      return action?.id === id || node.actionId === id;
    });
    expect(nodes, `public command plan must expose exactly one ${id} action`).toHaveLength(1);
    expect(isRecord(nodes[0]!.cache), `${id} must expose structured cache capability`).toBe(true);
    return nodes[0]!;
  };
  return Object.freeze({
    prefix: actionNode("profile-docker-data-prefix"),
    barrier: actionNode("profile-all-barrier"),
    suffix: actionNode("profile-docker-data-suffix"),
  });
}

async function quotaPath(): Promise<string> {
  const candidates = (process.env.PATH ?? "").split(":");
  try {
    for (const name of await readdir("/nix/store")) {
      if (/^[^-]+-quota-[^/]+$/.test(name)) candidates.push(`/nix/store/${name}/bin`);
    }
  } catch {
    // Non-Nix hosts can provide quota-tools on PATH.
  }
  for (const candidate of candidates) {
    if ((await command(["test"]).run(["-x", join(candidate, "setquota")])).exitCode === 0) {
      return [candidate, process.env.PATH ?? ""].filter(Boolean).join(":");
    }
  }
  throw new Error("project-quota tools (setquota/repquota) are required by this E2E");
}

async function invokeProfile(
  root: string,
  hostRoot: string,
  fixture: HostFixture,
  profile: string,
  demand: "v1" | "v2",
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  projectSourceRoot: string = root,
): Promise<{
  readonly evidence: SetupPrefixEvidence;
  readonly diagnostic: string;
  readonly execution: string;
  readonly cacheProgress: readonly string[];
  readonly setupPrefixKeys: readonly string[];
}> {
  const driver = await docker.run([
    "run", "--rm", "--network", "none", "--user", "0:0",
    "--mount", `type=bind,src=${process.cwd()},dst=${process.cwd()},readonly`,
    "--mount", `type=bind,src=${projectSourceRoot},dst=${root}`,
    "--mount", `type=bind,src=${hostRoot},dst=${hostRoot}`,
    "--mount", "type=bind,src=/run/docker.sock,dst=/run/docker.sock",
    "--workdir", root,
    "--env", `NICEEVAL_E2E_DOCKER_PROFILE_ALIAS=${profile}`,
    "--env", "NICEEVAL_E2E_SETUP_PREFIX_MODE=profile-full-copy",
    "--env", `NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV=${publicEnv}`,
    "--env", `XDG_STATE_HOME=${join(hostRoot, "state")}`,
    nodeImage,
    "sh", "-ec",
    `trap 'chown -R ${process.getuid!()}:${process.getgid!()} ${root}/.niceeval 2>/dev/null || true' EXIT
${profileRegistrySetup(fixture, profile, hostRoot)}
set +e
script -qefc 'stty cols 240 rows 50; exec node_modules/.bin/niceeval exp setup-prefix-cache --rerun all' /tmp/setup-prefix-exp.typescript
exp_status=$?
set -e
run_id=$(grep -aoE 'niceeval show --run [0-9a-f-]{36}' /tmp/setup-prefix-exp.typescript | tail -n 1 | awk '{print $4}')
test -n "$run_id"
node_modules/.bin/niceeval show --run "$run_id" --json >/tmp/setup-prefix-run.json
locator=$(node -e 'const fs=require("fs");const value=JSON.parse(fs.readFileSync("/tmp/setup-prefix-run.json","utf8"));const member=value?.data?.members?.find((entry)=>entry?.experiment==="setup-prefix-cache"&&entry?.locator);if(member)process.stdout.write(member.locator)')
test -n "$locator"
node_modules/.bin/niceeval show "$locator" --execution --json
exit "$exp_status"`,
  ], { cwd: root, timeoutMs: 240_000 });
  if (driver.exitCode !== 0) {
    const [host, ledgerEvents] = await Promise.all([
      setupPrefixHostObservation(fixture.journal).catch((cause: unknown) => ({
        observationError: cause instanceof Error ? cause.message : String(cause),
      })),
      setupPrefixLedgerEvents(fixture.journal).catch((cause: unknown) => [{
        event: "observation-error",
        reason: cause instanceof Error ? cause.message : String(cause),
      }]),
    ]);
    throw new Error([
      driver.diagnostic(),
      `public stdout tail:\n${driver.stdout.slice(-16_000)}`,
      `Host latest state: ${JSON.stringify(host)}`,
      `Host setup-prefix ledger events: ${JSON.stringify(ledgerEvents.slice(-24))}`,
    ].join("\n"));
  }
  const evidence = decodeEvidence(driver.stdout);
  expect(evidence).toMatchObject({
    demand,
    publicEnv,
    fixture: "not-requested",
    baseVersion: "raw-dind",
    runtimeMode: "profile-full-copy",
    innerDocker: `volume:${evidence.dockerDataPrefixMarker}`,
    outerWorkdirMarker: expect.any(String),
    outerBarrierMarker: evidence.outerWorkdirMarker,
    actionSideEffectCount: 1,
    dockerDataPrefixSideEffectCount: 1,
    barrierInnerSideEffectCount: 1,
    suffixDockerDataSideEffectCount: 1,
    agentPollutionBefore: 0,
  });
  await waitForSandboxGone(evidence.sandboxId, root);
  const cacheProgress = Object.freeze([
    ...new Set<string>(driver.stdout.match(/setup-prefix cache=[^\r\n]*/gu) ?? []),
  ]);
  const setupPrefixKeys = Object.freeze([
    ...new Set<string>(
      [...driver.stdout.matchAll(/"setupPrefixKey"\s*:\s*"(prefix:[a-f0-9]{64})"/gu)]
        .map((match) => match[1]!),
    ),
  ]);
  return {
    evidence,
    diagnostic: driver.diagnostic(),
    execution: driver.stdout,
    cacheProgress,
    setupPrefixKeys,
  };
}

async function copyPreparedProfileBuildContext(sourceRoot: string, targetRoot: string): Promise<void> {
  const relativeContext = "fixtures/setup-prefix/dind";
  await Promise.all([
    "Dockerfile",
    "node-rootfs.tar",
    "docker-rootfs.tar",
  ].map((name) => copyFile(
    join(sourceRoot, relativeContext, name),
    join(targetRoot, relativeContext, name),
  )));
}

async function interruptProfileCapture(
  root: string,
  hostRoot: string,
  fixture: HostFixture,
  profile: string,
): Promise<void> {
  const interrupted = await (async () => {
    try {
      return await withProcess(
        [
          "docker", "run", "--rm", "--network", "none", "--user", "0:0",
          "--mount", `type=bind,src=${process.cwd()},dst=${process.cwd()},readonly`,
          "--mount", `type=bind,src=${root},dst=${root}`,
          "--mount", `type=bind,src=${hostRoot},dst=${hostRoot}`,
          "--mount", "type=bind,src=/run/docker.sock,dst=/run/docker.sock",
          "--workdir", root,
          "--env", `NICEEVAL_E2E_DOCKER_PROFILE_ALIAS=${profile}`,
          "--env", "NICEEVAL_E2E_SETUP_PREFIX_MODE=profile-full-copy",
          "--env", "NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV=PUBLIC_MODE=alpha\n",
          "--env", `XDG_STATE_HOME=${join(hostRoot, "state")}`,
          nodeImage,
          "sh", "-ec",
          `${profileRegistrySetup(fixture, profile, hostRoot)}
exec node_modules/.bin/niceeval exp setup-prefix-cache --rerun all --json`,
        ],
        { processGroup: true, timeoutMs: 180_000, graceMs: 10_000 },
        async (controlled) => {
          await pollUntil(
            async () => {
              const result = await docker.run([
                "ps", "--all", "--filter", `label=niceeval.profile-id=${fixture.profileId}`,
                "--format", "{{.ID}} {{.State}}",
              ], { cwd: root });
              expect(result.exitCode, result.diagnostic()).toBe(0);
              return result.stdout.split(/\r?\n/u).some((line) => /\sexited$/u.test(line.trim()))
                ? true
                : undefined;
            },
            { timeoutMs: 60_000, intervalMs: 25, label: "fixed Profile stopped for setup-prefix capture" },
          );
          expect(controlled.signal("SIGINT")).toBe(true);
          const receipt = await controlled.done;
          expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
          expect(receipt.expReceipt(), receipt.diagnostic()).toMatchObject({ completion: "interrupted" });
          return receipt;
        },
      );
    } finally {
      const ownership = await sudo.run([
        "chown", "-R", `${process.getuid!()}:${process.getgid!()}`, join(root, ".niceeval"),
      ]);
      expect(ownership.exitCode, ownership.diagnostic()).toBe(0);
    }
  })();
  expect(interrupted.exitCode).toBe(130);
  try {
    await pollUntil(
      async () => {
        if (!(await setupPrefixHostObservation(fixture.journal)).settled) return undefined;
        return (await profileRuntimeResources(fixture.profileId)).length === 0 ? true : undefined;
      },
      { timeoutMs: 30_000, intervalMs: 100, label: "cancelled fixed Profile capture reconciliation and cleanup" },
    );
  } catch (cause) {
    const observation = await setupPrefixHostObservation(fixture.journal);
    throw new Error(
      `cancelled fixed Profile did not converge: ${JSON.stringify(observation)}`,
      { cause },
    );
  }
}

async function invoke(
  root: string,
  demand: "v1" | "v2",
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  options: {
    readonly image?: string;
    readonly baseVersion?: string;
    readonly mode?: "default" | "dynamic-tools" | "external-tmpfs" | "contention" | "capture-cancellation" | "canonical-json" | "raw-dind" | "profile-full-copy";
    readonly canonicalVariant?: "alpha" | "beta";
    readonly stateRoot?: string;
  } = {},
): Promise<SetupPrefixEvidence> {
  return (await invokeDetailed(root, demand, publicEnv, options)).evidence;
}

async function invokeDetailed(
  root: string,
  demand: "v1" | "v2",
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  options: {
    readonly image?: string;
    readonly baseVersion?: string;
    readonly mode?: "default" | "dynamic-tools" | "external-tmpfs" | "contention" | "capture-cancellation" | "canonical-json" | "raw-dind" | "profile-full-copy";
    readonly canonicalVariant?: "alpha" | "beta";
    readonly stateRoot?: string;
  } = {},
): Promise<{
  readonly evidence: SetupPrefixEvidence;
  readonly diagnostic: string;
  readonly execution: string;
}> {
  const mode = options.mode ?? "default";
  const invocationEnv = {
    NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV: publicEnv,
    NICEEVAL_E2E_SETUP_PREFIX_MODE: mode,
    ...(options.image === undefined ? {} : { NICEEVAL_E2E_SETUP_PREFIX_IMAGE: options.image }),
    ...(options.canonicalVariant === undefined
      ? {}
      : { NICEEVAL_E2E_SETUP_PREFIX_CANONICAL_VARIANT: options.canonicalVariant }),
    ...(options.stateRoot === undefined ? {} : { XDG_STATE_HOME: options.stateRoot }),
  };
  const run = await niceeval.run(["exp", "setup-prefix-cache", "--rerun", "all", "--json"], {
    cwd: root,
    env: invocationEnv,
    timeoutMs: 180_000,
  });
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
  const evaluation = only(
    run.ndjson<ExpEvent>(),
    (event): event is ExpEvalEvent => event.event === "eval" && event.evalId === "setup-prefix-cache",
    run.diagnostic(),
  );
  expect(evaluation, run.diagnostic()).toMatchObject({
    experimentId: "setup-prefix-cache",
    verdict: "passed",
    attempts: 1,
    passed: 1,
  });

  const execution = await niceeval.run(["show", evaluation.locator, "--execution", "--json"], {
    cwd: root,
    env: invocationEnv,
  });
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  const evidence = decodeEvidence(execution.stdout);
  expect(evidence).toMatchObject({
    demand,
    publicEnv,
    fixture: "stable setup-prefix fixture\n",
    baseVersion: options.baseVersion ?? "default",
    runtimeMode: mode,
    innerDocker: mode === "raw-dind" || mode === "profile-full-copy"
      ? "volume:niceeval-setup-prefix-inner-state"
      : "not-requested",
    outerWorkdirMarker: mode === "raw-dind" || mode === "profile-full-copy"
      ? expect.any(String)
      : "not-requested",
    actionSideEffectCount: mode === "raw-dind" || mode === "profile-full-copy" ? 1 : 0,
    canonicalToken: mode === "canonical-json" ? expect.any(String) : "not-requested",
  });
  await waitForSandboxGone(evidence.sandboxId, root);
  return { evidence, diagnostic: run.diagnostic(), execution: execution.stdout };
}

async function exportImageRootfs(image: string, destination: string): Promise<void> {
  const created = await docker.run(["create", image]);
  expect(created.exitCode, created.diagnostic()).toBe(0);
  const containerId = created.stdout.trim();
  try {
    const exported = await docker.run(["export", "--output", destination, containerId], { timeoutMs: 60_000 });
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
  } finally {
    const removed = await docker.run(["rm", "--force", containerId]);
    expect(removed.exitCode, removed.diagnostic()).toBe(0);
  }
}

test("独立 Invocation 只重新执行变化的 Sandbox setup 后缀，并为每个 Attempt 提供私有 writable clone", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-owner-state-", async (stateRoot) =>
    withProjectCopy(projectCopy, async ({ root }) => {
      // A unique context byte makes the first invocation a true cold BuildKey even
      // when a reliability repetition reuses the same host Docker daemon.
      await writeFile(
        join(root, "fixtures/setup-prefix/image/build-seed.txt"),
        `${randomUUID()}\n`,
        "utf8",
      );

      const coldRun = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", { stateRoot });
      const cold = coldRun.evidence;

      const evalPath = join(root, "evals/setup-prefix-cache.eval.ts");
      const originalEval = await readFile(evalPath, "utf8");
      const changedEval = originalEval.replace('const DEMAND = "v1";', 'const DEMAND = "v2";');
      expect(changedEval, "the private project copy must change the Eval result demand").not.toBe(originalEval);
      await writeFile(evalPath, changedEval, "utf8");

      const changedDemandRun = await invokeDetailed(root, "v2", "PUBLIC_MODE=alpha\n", { stateRoot });
      const changedDemand = changedDemandRun.evidence;
      const demandDiagnostic = `${coldRun.diagnostic}\n${changedDemandRun.diagnostic}`;
      expect(changedDemand.buildToken, demandDiagnostic).toBe(cold.buildToken);
      expect(changedDemand.fixtureToken, demandDiagnostic).toBe(cold.fixtureToken);
      expect(changedDemand.envToken, demandDiagnostic).toBe(cold.envToken);
      expect(changedDemandRun.execution).not.toContain(".setup-prefix/env-token");

      const changedEnv = await invokeDetailed(root, "v2", "PUBLIC_MODE=beta\n", { stateRoot });
      expect(changedEnv.evidence.buildToken).toBe(cold.buildToken);
      expect(changedEnv.evidence.fixtureToken).toBe(cold.fixtureToken);
      expect(changedEnv.evidence.envToken).not.toBe(changedDemand.envToken);
      expect(changedEnv.execution).toContain('"phase":"sandbox.prepare"');
      expect(changedEnv.execution).toContain(".setup-prefix/env-token");

      expect(new Set([cold.sandboxId, changedDemand.sandboxId, changedEnv.evidence.sandboxId]).size).toBe(3);
    }),
  );
});

test("浮动 Docker tag 改指后从新的 exact Base 建立准备前缀", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const image = `niceeval-e2e/setup-prefix-floating:${randomUUID()}`;
    const context = join(root, "fixtures/setup-prefix/image");
    try {
      const firstBuild = await docker.run([
        "build", "--build-arg", "SETUP_BASE_VERSION=v1", "--tag", image, context,
      ], { cwd: root, timeoutMs: 180_000 });
      expect(firstBuild.exitCode, firstBuild.diagnostic()).toBe(0);
      const first = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", { image, baseVersion: "v1" });

      const secondBuild = await docker.run([
        "build", "--build-arg", "SETUP_BASE_VERSION=v2", "--tag", image, context,
      ], { cwd: root, timeoutMs: 180_000 });
      expect(secondBuild.exitCode, secondBuild.diagnostic()).toBe(0);
      const second = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", { image, baseVersion: "v2" });

      expect(second.buildToken).not.toBe(first.buildToken);
      expect(second.fixtureToken).not.toBe(first.fixtureToken);
      expect(second.sandboxId).not.toBe(first.sandboxId);
    } finally {
      await docker.run(["image", "rm", image], { cwd: root });
    }
  });
});

test("危险名称 Action metadata 在 alpha 与 beta 间不碰撞且返回 alpha 时命中原前缀", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-canonical-json-state-", async (stateRoot) => {
    await withProjectCopy(projectCopy, async ({ root }) => {
      await writeFile(join(root, "fixtures/setup-prefix/image/build-seed.txt"), `${randomUUID()}\n`, "utf8");
      const alpha = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "alpha",
        stateRoot,
      });
      const beta = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "beta",
        stateRoot,
      });
      expect(beta.evidence.canonicalToken).not.toBe(alpha.evidence.canonicalToken);
      expect(beta.execution).toContain(".setup-prefix/canonical-token");

      const alphaAgain = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "alpha",
        stateRoot,
      });
      expect(alphaAgain.evidence.canonicalToken).toBe(alpha.evidence.canonicalToken);
      expect(alphaAgain.execution).not.toContain(".setup-prefix/canonical-token");
    });
  });
});

test("动态安装 runner tools 的实例永久 Unsupported 并真实重放 before", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const image = `niceeval-e2e/setup-prefix-dynamic-tools:${randomUUID()}`;
    const context = join(root, "fixtures/setup-prefix/image");
    try {
      const built = await docker.run([
        "build", "--file", join(context, "Dockerfile.dynamic-tools"), "--tag", image, context,
      ], { cwd: root, timeoutMs: 180_000 });
      expect(built.exitCode, built.diagnostic()).toBe(0);
      const first = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", {
        image,
        baseVersion: "dynamic-tools",
        mode: "dynamic-tools",
      });
      const second = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", {
        image,
        baseVersion: "dynamic-tools",
        mode: "dynamic-tools",
      });
      expect(second.buildToken).toBe(first.buildToken);
      expect(second.fixtureToken).not.toBe(first.fixtureToken);
      expect(second.envToken).not.toBe(first.envToken);
      expect(second.sandboxId).not.toBe(first.sandboxId);
    } finally {
      await docker.run(["image", "rm", image], { cwd: root });
    }
  });
});

test("tmpfs 外置 mutable state 为 Unsupported 且每次都真实重放", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    await writeFile(join(root, "fixtures/setup-prefix/image/build-seed.txt"), `${randomUUID()}\n`, "utf8");
    const first = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", { mode: "external-tmpfs" });
    const second = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", { mode: "external-tmpfs" });
    expect(second.buildToken).toBe(first.buildToken);
    expect(second.fixtureToken).not.toBe(first.fixtureToken);
    expect(second.envToken).not.toBe(first.envToken);
    expect(second.sandboxId).not.toBe(first.sandboxId);
  });
});

test("两个 Invocation 竞争同一前缀时 loser 保留私有 staging 并禁用后续 publication", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-contention-state-", async (stateRoot) => {
    await withProjectCopy(projectCopy, async ({ root: firstRoot }) => {
      await withProjectCopy(projectCopy, async ({ root: secondRoot }) => {
        const image = `niceeval-e2e/setup-prefix-contention:${randomUUID()}`;
        const context = join(firstRoot, "fixtures/setup-prefix/image");
        try {
          const built = await docker.run(["build", "--tag", image, context], {
            cwd: firstRoot,
            timeoutMs: 180_000,
          });
          expect(built.exitCode, built.diagnostic()).toBe(0);
          const [first, second] = await Promise.all([
            invokeDetailed(firstRoot, "v1", "PUBLIC_MODE=alpha\n", {
              image,
              mode: "contention",
              stateRoot,
            }),
            invokeDetailed(secondRoot, "v1", "PUBLIC_MODE=alpha\n", {
              image,
              mode: "contention",
              stateRoot,
            }),
          ]);
          expect(first.evidence.fixtureToken).not.toBe(second.evidence.fixtureToken);
          const competingDiagnostics = [first.diagnostic, second.diagnostic];
          expect(
            competingDiagnostics.some((value) =>
              value.includes("setup-prefix cache=replay reason=contended")),
            competingDiagnostics.join("\n\n--- competing invocation ---\n\n"),
          ).toBe(true);

          const follower = await invokeDetailed(firstRoot, "v1", "PUBLIC_MODE=alpha\n", {
            image,
            mode: "contention",
            stateRoot,
          });
          expect([first.evidence.fixtureToken, second.evidence.fixtureToken])
            .toContain(follower.evidence.fixtureToken);
          expect([first.evidence.envToken, second.evidence.envToken])
            .toContain(follower.evidence.envToken);
        } finally {
          await docker.run(["image", "rm", image], { cwd: firstRoot });
        }
      });
    });
  });
});

test("raw DinD 在 graceful quiesce 后完整恢复 inner state 且每个 Attempt 使用私有 clone", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const context = join(root, "fixtures/setup-prefix/dind");
    await exportImageRootfs(nodeImage, join(context, "node-rootfs.tar"));
    await exportImageRootfs(dindImage, join(context, "docker-rootfs.tar"));

    const cold = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", {
      baseVersion: "raw-dind",
      mode: "raw-dind",
    });
    const restored = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", {
      baseVersion: "raw-dind",
      mode: "raw-dind",
    });
    expect(restored.buildToken).toBe(cold.buildToken);
    expect(restored.fixtureToken).toBe(cold.fixtureToken);
    expect(restored.envToken).toBe(cold.envToken);
    expect(restored.innerDocker).toBe("volume:niceeval-setup-prefix-inner-state");
    expect(restored.outerWorkdirMarker).toBe(cold.outerWorkdirMarker);
    expect(restored.actionSideEffectCount).toBe(cold.actionSideEffectCount);
    expect(restored.sandboxId).not.toBe(cold.sandboxId);
  });
});

test("Profile 在取消后回收 Host ownership，并为后续 Invocation 恢复私有 inner Docker 前缀", async () => {
  const scripts = process.env.NICEEVAL_E2E_DOCKER_PROFILE_HOST_SCRIPTS;
  expect(scripts, "runner must inject the actual Docker profile host scripts").toBeTruthy();
  const fixtureScript = resolve("fixtures/profile-host-fixture.py");
  const dockerInfo = await docker.run(["info", "--format", "{{.DockerRootDir}}"]);
  expect(dockerInfo.exitCode, dockerInfo.diagnostic()).toBe(0);
  const hostPath = await quotaPath();
  const user = process.env.USER ?? process.env.LOGNAME;
  expect(user, "E2E runner user must be named for the quota-slot owner").toBeTruthy();
  const group = await command(["id"]).run(["-gn", user!]);
  expect(group.exitCode, group.diagnostic()).toBe(0);

  await withProjectCopy(projectCopy, async ({ root }) => {
    const context = join(root, "fixtures/setup-prefix/dind");
    await exportImageRootfs(nodeImage, join(context, "node-rootfs.tar"));
    await exportImageRootfs(dindImage, join(context, "docker-rootfs.tar"));
    const inspectedBuildkit = await docker.run(["image", "inspect", buildkitImage]);
    if (inspectedBuildkit.exitCode !== 0) {
      const pulledBuildkit = await docker.run(["pull", buildkitImage], { timeoutMs: 120_000 });
      expect(pulledBuildkit.exitCode, pulledBuildkit.diagnostic()).toBe(0);
    }
    await appendFile(join(context, "Dockerfile"), `\n# profile-full-copy-owner ${randomUUID()}\n`);

    await withTempDir("niceeval-e2e-docker-profile-shared-loop-", async (sharedHostRoot) => {
      const sharedProfile = `e2e-setup-prefix-shared-${randomUUID()}`;
      let sharedFixture: HostFixture | undefined;
      let sharedError: unknown;
      try {
        const setup = await sudo.run([
          "env", `PATH=${hostPath}`,
          "python3", fixtureScript, "setup",
          "--root", sharedHostRoot,
          "--scripts", scripts!,
          "--docker-root", dockerInfo.stdout.trim(),
          "--user", user!,
          "--group", group.stdout.trim(),
          "--name", sharedProfile,
        ], { timeoutMs: 60_000 });
        expect(setup.exitCode, setup.diagnostic()).toBe(0);
        sharedFixture = JSON.parse(setup.stdout.trim().split("\n").at(-1)!) as HostFixture;
        await withProcess(
          [
            "sudo", "-n", "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
            "python3", join(scripts!, "watchdog.py"),
            "--control-socket", sharedFixture.controlSocket,
            "--descriptor", sharedFixture.descriptor,
            "--host-config", sharedFixture.hostConfig,
            "--docker-socket", "/run/docker.sock",
            "--journal", sharedFixture.journal,
            "--ready-file", sharedFixture.readyFile,
            "--socket-mode", "0o600",
          ],
          { processGroup: true, timeoutMs: 90_000, graceMs: 5_000 },
          async (watchdog) => {
            await Promise.race([
              pollUntil(() => fileExists(sharedFixture!.readyFile), {
                timeoutMs: 15_000,
                intervalMs: 100,
                label: "shared-loop Profile watchdog ready file",
              }),
              watchdog.done.then((receipt) => {
                throw new Error(`shared-loop watchdog exited before readiness\n${receipt.diagnostic()}`);
              }),
            ]);
            const actions = await debugProfileSetupPrefix(
              root,
              sharedHostRoot,
              sharedFixture!,
              sharedProfile,
            );
            const cache = actions.prefix.cache as JsonRecord;
            expect(
              cache.capability,
              "a shared loop-ext4 Profile without docker-data snapshot capability must remain explicitly Unsupported",
            ).toBe("unsupported");
            expect(cache.capabilityReason).toEqual(expect.stringContaining("Docker Profile"));
            expect(cache.state).toEqual({
              declared: "dockerData",
              cumulative: "dockerData",
              providerCoverage: "unsupported",
              barrier: "provider-unsupported",
            });
            expect(cache.eligibility).toEqual({
              status: "ineligible",
              reason: { code: "provider-unsupported" },
            });

            const sharedCold = await invokeProfile(
              root,
              sharedHostRoot,
              sharedFixture!,
              sharedProfile,
              "v1",
              "PUBLIC_MODE=alpha\n",
            );
            const sharedReplay = await invokeProfile(
              root,
              sharedHostRoot,
              sharedFixture!,
              sharedProfile,
              "v1",
              "PUBLIC_MODE=alpha\n",
            );
            expect(sharedReplay.evidence.dockerDataPrefixMarker)
              .not.toBe(sharedCold.evidence.dockerDataPrefixMarker);
            expect(sharedReplay.evidence.outerBarrierMarker)
              .not.toBe(sharedCold.evidence.outerBarrierMarker);
            expect(sharedReplay.evidence.suffixDockerDataMarker)
              .not.toBe(sharedCold.evidence.suffixDockerDataMarker);
            expect(sharedReplay.evidence.sandboxId).not.toBe(sharedCold.evidence.sandboxId);
          },
        );
      } catch (error) {
        sharedError = error;
        throw error;
      } finally {
        if (sharedFixture !== undefined) {
          const cleanup = await sudo.run([
            "env", `PATH=${hostPath}`,
            "python3", fixtureScript, "cleanup", "--root", sharedHostRoot,
          ], { timeoutMs: 30_000 });
          if (cleanup.exitCode !== 0) {
            const cleanupError = new Error(cleanup.diagnostic());
            if (sharedError !== undefined) {
              throw new AggregateError(
                [sharedError, cleanupError],
                "shared-loop Unsupported observation and cleanup both failed",
              );
            }
            throw cleanupError;
          }
        }
      }
    });

    await withTempDir("niceeval-e2e-docker-profile-", async (hostRoot) => {
      const profile = `e2e-setup-prefix-${randomUUID()}`;
      let fixture: HostFixture | undefined;
      let primaryError: unknown;
      try {
        const setup = await sudo.run([
          "env", `PATH=${hostPath}`,
          "python3", fixtureScript, "setup",
          "--root", hostRoot,
          "--scripts", scripts!,
          "--docker-root", dockerInfo.stdout.trim(),
          "--user", user!,
          "--group", group.stdout.trim(),
          "--name", profile,
          "--setup-prefix",
        ], { timeoutMs: 60_000 });
        expect(setup.exitCode, setup.diagnostic()).toBe(0);
        fixture = JSON.parse(setup.stdout.trim().split("\n").at(-1)!) as HostFixture;

        await withProcess(
          [
            "sudo", "-n", "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
            "python3", join(scripts!, "watchdog.py"),
            "--control-socket", fixture.controlSocket,
            "--descriptor", fixture.descriptor,
            "--host-config", fixture.hostConfig,
            "--docker-socket", "/run/docker.sock",
            "--journal", fixture.journal,
            "--ready-file", fixture.readyFile,
            "--socket-mode", "0o600",
          ],
          { processGroup: true, timeoutMs: 330_000, graceMs: 5_000 },
          async (watchdog) => {
            await Promise.race([
              pollUntil(() => fileExists(fixture!.readyFile), {
                timeoutMs: 15_000,
                intervalMs: 100,
                label: "isolated profile SetupPrefix watchdog ready file",
              }),
              watchdog.done.then((receipt) => {
                throw new Error(`watchdog exited before readiness\n${receipt.diagnostic()}`);
              }),
            ]);

            const actions = await debugProfileSetupPrefix(root, hostRoot, fixture!, profile);
            const cache = actions.prefix.cache as JsonRecord;
            expect(
              cache.capability,
              "the fixed raw-image Profile must publicly declare persistent setup-prefix capability",
            ).toBe("persistent");
            expect(cache.state).toEqual({
              declared: "dockerData",
              cumulative: "dockerData",
              providerCoverage: "dockerData",
              barrier: "none",
            });
            expect(cache.eligibility).toEqual({ status: "eligible" });
            expect(actions.barrier.cache).toMatchObject({
              capability: "persistent",
              eligibility: { status: "ineligible", reason: { code: "unsupported-state" } },
              state: {
                declared: "all",
                cumulative: "all",
                providerCoverage: "dockerData",
                barrier: "unsupported-state",
              },
            });
            expect(actions.suffix.cache).toMatchObject({
              capability: "persistent",
              eligibility: { status: "ineligible", reason: { code: "unsupported-state-ancestor" } },
              state: {
                declared: "dockerData",
                cumulative: "all",
                providerCoverage: "dockerData",
                barrier: "unsupported-state-ancestor",
              },
            });

            const allStateActions = await debugProfileSetupPrefix(root, hostRoot, fixture!, profile, "all");
            const actionFingerprint = (node: JsonRecord): JsonRecord => {
              expect(isRecord(node.action)).toBe(true);
              const fingerprint = (node.action as JsonRecord).fingerprint;
              expect(isRecord(fingerprint)).toBe(true);
              return fingerprint as JsonRecord;
            };
            expect(actionFingerprint(allStateActions.prefix).automatic)
              .not.toBe(actionFingerprint(actions.prefix).automatic);
            expect(actionFingerprint(allStateActions.barrier).automatic)
              .toBe(actionFingerprint(actions.barrier).automatic);
            expect(actionFingerprint(allStateActions.suffix).automatic)
              .toBe(actionFingerprint(actions.suffix).automatic);
            expect((actions.prefix.cache as JsonRecord).prefixIdentity)
              .toMatch(/^linked-prefix:/u);
            expect((allStateActions.prefix.cache as JsonRecord).prefixIdentity)
              .toMatch(/^linked-prefix:/u);
            expect(
              (allStateActions.prefix.cache as JsonRecord).prefixIdentity,
              "public debug must change the linked prefix identity when only declared state changes",
            ).not.toBe((actions.prefix.cache as JsonRecord).prefixIdentity);
            expect(allStateActions.prefix.cache).toMatchObject({
              eligibility: { status: "ineligible", reason: { code: "unsupported-state" } },
              state: {
                declared: "all",
                cumulative: "all",
                providerCoverage: "dockerData",
                barrier: "unsupported-state",
              },
            });

            await interruptProfileCapture(root, hostRoot, fixture!, profile);
            const coldRun = await invokeProfile(root, hostRoot, fixture!, profile, "v1", "PUBLIC_MODE=alpha\n");
            expect(
              coldRun.execution,
              "the first fixed Profile retry after cancellation must replay A instead of restoring a cancelled publish",
            ).toContain("niceeval.e2e.setup-prefix-role=docker-data-prefix");
            const cold = coldRun.evidence;
            const restoredReaders = await withProjectCopy(projectCopy, async ({ root: firstReaderRoot }) =>
              withProjectCopy(projectCopy, async ({ root: secondReaderRoot }) => {
                await Promise.all([
                  copyPreparedProfileBuildContext(root, firstReaderRoot),
                  copyPreparedProfileBuildContext(root, secondReaderRoot),
                ]);
                const readerPlans = await Promise.all([
                  debugProfileSetupPrefix(root, hostRoot, fixture!, profile, "dockerData", firstReaderRoot),
                  debugProfileSetupPrefix(root, hostRoot, fixture!, profile, "dockerData", secondReaderRoot),
                ]);
                expect(readerPlans.map((plan) => (plan.prefix.cache as JsonRecord).prefixIdentity))
                  .toEqual([
                    (actions.prefix.cache as JsonRecord).prefixIdentity,
                    (actions.prefix.cache as JsonRecord).prefixIdentity,
                  ]);
                return Promise.all([
                  invokeProfile(root, hostRoot, fixture!, profile, "v1", "PUBLIC_MODE=alpha\n", firstReaderRoot),
                  invokeProfile(root, hostRoot, fixture!, profile, "v1", "PUBLIC_MODE=alpha\n", secondReaderRoot),
                ]);
              }));
            const restored = restoredReaders[0]!;
            const concurrentReader = restoredReaders[1]!;
            const ledgerEvents = await setupPrefixLedgerEvents(fixture!.journal);
            expect(
              restoredReaders.map((reader) => reader.evidence.dockerDataPrefixMarker),
              "both unchanged concurrent Invocations must restore A's dockerData prefix instead of rerunning " +
                `its inner side effect; prefixIdentity=${String(cache.prefixIdentity)}; ` +
                `cold setupPrefixKey=${JSON.stringify(coldRun.setupPrefixKeys)}; ` +
                `warm setupPrefixKey=${JSON.stringify(restoredReaders.map((reader) => reader.setupPrefixKeys))}; ` +
                `host ledger=${JSON.stringify(ledgerEvents)}`,
            ).toEqual([cold.dockerDataPrefixMarker, cold.dockerDataPrefixMarker]);
            expect(restoredReaders.map((reader) => reader.evidence.dockerDataPrefixSideEffectCount))
              .toEqual([1, 1]);
            expect(restored.evidence.buildToken, restored.diagnostic).toBe(cold.buildToken);
            expect(
              restored.evidence.outerBarrierMarker,
              "B's default all state writes tmpfs/workdir and must replay after the dockerData prefix hit",
            ).not.toBe(cold.outerBarrierMarker);
            expect(
              restored.evidence.barrierInnerMarker,
              "the same B all-state action's inner Docker effect must replay with its outer marker",
            ).not.toBe(cold.barrierInnerMarker);
            expect(
              restored.evidence.suffixDockerDataMarker,
              "C is dockerData but has an unsupported all-state ancestor and must replay",
            ).not.toBe(cold.suffixDockerDataMarker);
            expect(restored.evidence.barrierInnerSideEffectCount).toBe(1);
            expect(restored.evidence.suffixDockerDataSideEffectCount).toBe(1);
            expect(
              restored.evidence.agentPollutionBefore,
              "a restored private slot must start from the immutable A seed without prior Agent pollution",
            ).toBe(0);
            expect(concurrentReader.evidence.dockerDataPrefixMarker).toBe(cold.dockerDataPrefixMarker);
            expect(concurrentReader.evidence.agentPollutionBefore).toBe(0);
            expect(concurrentReader.evidence.outerBarrierMarker).not.toBe(restored.evidence.outerBarrierMarker);
            expect(concurrentReader.evidence.barrierInnerMarker).not.toBe(restored.evidence.barrierInnerMarker);
            expect(concurrentReader.evidence.suffixDockerDataMarker)
              .not.toBe(restored.evidence.suffixDockerDataMarker);
            expect(concurrentReader.evidence.sandboxId).not.toBe(restored.evidence.sandboxId);

            const evalPath = join(root, "evals/setup-prefix-cache.eval.ts");
            const originalEval = await readFile(evalPath, "utf8");
            const changedEval = originalEval.replace('const DEMAND = "v1";', 'const DEMAND = "v2";');
            expect(changedEval).not.toBe(originalEval);
            await writeFile(evalPath, changedEval, "utf8");
            const changedDemand = await invokeProfile(root, hostRoot, fixture!, profile, "v2", "PUBLIC_MODE=alpha\n");
            expect(changedDemand.evidence.buildToken).toBe(cold.buildToken);
            expect(changedDemand.evidence.dockerDataPrefixMarker).toBe(cold.dockerDataPrefixMarker);
            expect(changedDemand.evidence.outerBarrierMarker).not.toBe(restored.evidence.outerBarrierMarker);
            expect(changedDemand.evidence.barrierInnerMarker).not.toBe(restored.evidence.barrierInnerMarker);
            expect(changedDemand.evidence.suffixDockerDataMarker).not.toBe(restored.evidence.suffixDockerDataMarker);
            expect(changedDemand.evidence.agentPollutionBefore).toBe(0);

            const changedEnv = await invokeProfile(root, hostRoot, fixture!, profile, "v2", "PUBLIC_MODE=beta\n");
            expect(changedEnv.evidence.buildToken).toBe(cold.buildToken);
            expect(changedEnv.evidence.dockerDataPrefixMarker).toBe(cold.dockerDataPrefixMarker);
            expect(changedEnv.evidence.outerBarrierMarker).not.toBe(changedDemand.evidence.outerBarrierMarker);
            expect(changedEnv.evidence.barrierInnerMarker).not.toBe(changedDemand.evidence.barrierInnerMarker);
            expect(changedEnv.evidence.suffixDockerDataMarker).not.toBe(changedDemand.evidence.suffixDockerDataMarker);
            expect(changedEnv.evidence.agentPollutionBefore).toBe(0);
            expect(new Set([
              cold.sandboxId,
              restored.evidence.sandboxId,
              concurrentReader.evidence.sandboxId,
              changedDemand.evidence.sandboxId,
              changedEnv.evidence.sandboxId,
            ]).size).toBe(5);
            await pollUntil(
              async () => (await profileRuntimeResources(fixture!.profileId)).length === 0
                ? true
                : undefined,
              {
                timeoutMs: 15_000,
                intervalMs: 100,
                label: "Profile SetupPrefix containers and networks released",
              },
            );
          },
        );
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        if (fixture !== undefined) {
          const cleanup = await sudo.run([
            "env", `PATH=${hostPath}`,
            "python3", fixtureScript, "cleanup", "--root", hostRoot,
          ], { timeoutMs: 30_000 });
          if (cleanup.exitCode !== 0) {
            const cleanupError = new Error(cleanup.diagnostic());
            if (primaryError !== undefined) {
              throw new AggregateError([primaryError, cleanupError], "Profile SetupPrefix owner and cleanup both failed");
            }
            throw cleanupError;
          }
        }
      }
    });
  });
}, 360_000);

test("SIGINT 在真实 Docker capture 中取消后不得 publish、adopt 或 rebase", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-cancellation-state-", async (stateRoot) => {
    await withProjectCopy(projectCopy, async ({ root }) => {
      const image = `niceeval-e2e/setup-prefix-cancellation:${randomUUID()}`;
      const context = join(root, "fixtures/setup-prefix/image");
      try {
        const built = await docker.run(["build", "--tag", image, context], { cwd: root, timeoutMs: 180_000 });
        expect(built.exitCode, built.diagnostic()).toBe(0);
        const interrupted = await withProcess(
          [binary, "exp", "setup-prefix-cache", "--rerun", "all", "--json"],
          {
            cwd: root,
            env: {
              NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV: "PUBLIC_MODE=alpha\n",
              NICEEVAL_E2E_SETUP_PREFIX_IMAGE: image,
              NICEEVAL_E2E_SETUP_PREFIX_MODE: "capture-cancellation",
              XDG_STATE_HOME: stateRoot,
            },
            processGroup: true,
            timeoutMs: 180_000,
            graceMs: 10_000,
          },
          async (controlled) => {
            const pid = controlled.pid;
            expect(pid, "NiceEval invocation must expose its provider ownership pid").toEqual(expect.any(Number));
            await pollUntil(
              async () => {
                const ids = await containersForInvocation(pid!, root);
                for (const id of ids) {
                  const status = await docker.run(["inspect", "--format", "{{.State.Status}}", id], { cwd: root });
                  if (status.exitCode === 0 && status.stdout.trim() === "exited") return id;
                }
                return undefined;
              },
              { timeoutMs: 60_000, intervalMs: 25, label: "outer Docker container stopped for setup-prefix capture" },
            );
            expect(controlled.signal("SIGINT")).toBe(true);
            const receipt = await controlled.done;
            expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
            expect(receipt.expReceipt(), receipt.diagnostic()).toMatchObject({ completion: "interrupted" });
            return { receipt, pid: pid! };
          },
        );
        expect(interrupted.receipt.exitCode).toBe(130);
        await pollUntil(
          async () => (await containersForInvocation(interrupted.pid, root)).length === 0 ? true : undefined,
          { timeoutMs: 15_000, intervalMs: 100, label: "cancelled setup-prefix staging and clone cleanup" },
        );

        const retry = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
          image,
          mode: "capture-cancellation",
          stateRoot,
        });
        expect(retry.execution).toContain(".setup-prefix/capture-payload.bin");
      } finally {
        await docker.run(["image", "rm", image], { cwd: root });
      }
    });
  });
});
