// owner: docs/engineering/testing/e2e/README.md#sandbox-setup-prefix-cache
// rerun: pnpm e2e test --repo lifecycle -- --run test/sandbox-setup-prefix-cache.test.ts

import { randomUUID } from "node:crypto";
import { appendFile, copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExpEvalEvent, ExpEvent, ProcessHandle } from "@niceeval/testkit";
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
  readonly operationId?: string;
  readonly operationIds?: readonly string[];
  readonly seedScrubbed?: boolean;
  readonly setupPrefixKey?: string;
  readonly reason?: string;
}

interface SetupPrefixHostObservation {
  readonly settled: boolean;
  readonly degraded: readonly unknown[];
  readonly leases: readonly JsonRecord[];
  readonly reservations: readonly JsonRecord[];
  readonly queue: readonly unknown[];
  readonly slots: readonly JsonRecord[];
  readonly operations: readonly JsonRecord[];
}

interface PublishedSeedObservation {
  readonly artifactId: string;
  readonly seedId: string;
  readonly marker: string;
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

async function fixtureHostFileExists(path: string): Promise<boolean> {
  const result = await sudo.run(["test", "-f", path]);
  expect([0, 1]).toContain(result.exitCode);
  return result.exitCode === 0;
}

async function readFixtureJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFixtureHostFile(path)) as JsonRecord;
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
      ...(typeof detail.operationId === "string" ? { operationId: detail.operationId } : {}),
      ...(Array.isArray(detail.operationIds) && detail.operationIds.every((item) => typeof item === "string")
        ? { operationIds: detail.operationIds as readonly string[] }
        : {}),
      ...(typeof detail.seedScrubbed === "boolean" ? { seedScrubbed: detail.seedScrubbed } : {}),
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
    quarantineReason: slot.quarantineReason,
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
    degraded: Object.freeze(Array.isArray(state.degraded) ? [...state.degraded] : []),
    leases: Object.freeze(leaseSummary),
    reservations: Object.freeze(reservationSummary),
    queue: Object.freeze([...queue]),
    slots: Object.freeze(slotSummary),
    operations: Object.freeze(operationSummary),
  });
}

async function fixedSlotPrefixMarkers(fixture: HostFixture): Promise<readonly string[]> {
  const config = JSON.parse(await readFixtureHostFile(fixture.hostConfig)) as JsonRecord;
  const storage = isRecord(config.storage) ? config.storage : {};
  expect(storage.slotRegistryPath).toEqual(expect.any(String));
  const registry = JSON.parse(await readFixtureHostFile(String(storage.slotRegistryPath))) as JsonRecord;
  const slots = Array.isArray(registry.slots) ? registry.slots.filter(isRecord) : [];
  const paths = slots.map((slot) => String(slot.path));
  expect(paths.length).toBeGreaterThan(0);
  const result = await sudo.run([
    "find", ...paths, "-type", "d",
    "-name", "niceeval-setup-prefix-prefix-*", "-printf", "%f\n",
  ]);
  expect(result.exitCode, result.diagnostic()).toBe(0);
  return Object.freeze([...new Set(result.stdout.trim().split(/\r?\n/u).filter(Boolean))].sort());
}

async function publishedSeedObservation(
  path: string,
  expectedMarker?: string,
): Promise<PublishedSeedObservation> {
  const lines = (await readFixtureHostFile(path)).trim().split(/\r?\n/u);
  const latest = JSON.parse(lines.at(-1) ?? "{}") as JsonRecord;
  const state = isRecord(latest.state) ? latest.state : {};
  const setupPrefix = isRecord(state.setupPrefix) ? state.setupPrefix : {};
  const publishedArtifacts = isRecord(setupPrefix.artifacts)
    ? Object.values(setupPrefix.artifacts).filter(isRecord)
    : [];
  const seeds = isRecord(setupPrefix.seeds) ? setupPrefix.seeds : {};
  const observations: PublishedSeedObservation[] = [];
  for (const artifact of publishedArtifacts) {
    expect(artifact).toMatchObject({ state: "published", artifactId: expect.any(String), seedId: expect.any(String) });
    const seed = isRecord(seeds[String(artifact.seedId)]) ? seeds[String(artifact.seedId)] as JsonRecord : {};
    expect(seed).toMatchObject({ state: "published", imagePath: expect.any(String) });
    const listed = await sudo.run(["debugfs", "-R", "ls -p /volumes", String(seed.imagePath)]);
    expect(listed.exitCode, listed.diagnostic()).toBe(0);
    const markers = [...new Set(listed.stdout.match(/niceeval-setup-prefix-prefix-[a-f0-9-]{36}/gu) ?? [])];
    expect(markers, `published seed ${String(artifact.seedId)} must contain one prefix marker`).toHaveLength(1);
    observations.push(Object.freeze({
      artifactId: String(artifact.artifactId),
      seedId: String(artifact.seedId),
      marker: markers[0]!,
    }));
  }
  const matches = expectedMarker === undefined
    ? observations
    : observations.filter((observation) => observation.marker === expectedMarker);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

async function latestSetupPrefixRestore(path: string): Promise<JsonRecord> {
  const records = (await readFixtureHostFile(path)).trim().split(/\r?\n/u)
    .map((line) => JSON.parse(line) as JsonRecord)
    .filter((record) => record.event === "setup-prefix-restored");
  expect(records.length).toBeGreaterThan(0);
  const detail = records.at(-1)!.detail;
  expect(isRecord(detail)).toBe(true);
  return detail as JsonRecord;
}

async function activeCaptureCopying(path: string): Promise<boolean> {
  const records = (await readFixtureHostFile(path)).trim().split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
  const latest = records.at(-1);
  const state = latest !== undefined && isRecord(latest.state) ? latest.state : {};
  const setupPrefix = isRecord(state.setupPrefix) ? state.setupPrefix : {};
  const operations = isRecord(setupPrefix.operations)
    ? Object.values(setupPrefix.operations).filter(isRecord)
    : [];
  if (operations.length !== 1) return false;
  const operation = operations[0]!;
  if (operation.kind !== "capture" || operation.state !== "capturing") return false;
  return records.some((record) =>
    record.event === "setup-prefix-capture-copying" &&
    isRecord(record.detail) && record.detail.operationId === operation.operationId);
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
): Promise<string> {
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
          const cancelledMarkers = await pollUntil(
            async () => {
              const markers = await fixedSlotPrefixMarkers(fixture);
              if (markers.length > 1) {
                throw new Error(`cancelled Attempt exposed multiple dockerData prefix markers: ${markers.join(", ")}`);
              }
              if (markers.length !== 1) return undefined;
              return await activeCaptureCopying(fixture.journal) ? markers : undefined;
            },
            { timeoutMs: 10_000, intervalMs: 25, label: "active capture copy with cancelled Attempt marker" },
          );
          expect(controlled.signal("SIGINT")).toBe(true);
          const receipt = await controlled.done;
          expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
          expect(receipt.expReceipt(), receipt.diagnostic()).toMatchObject({ completion: "interrupted" });
          return { receipt, cancelledMarker: cancelledMarkers[0]! };
        },
      );
    } finally {
      const ownership = await sudo.run([
        "chown", "-R", `${process.getuid!()}:${process.getgid!()}`, join(root, ".niceeval"),
      ]);
      expect(ownership.exitCode, ownership.diagnostic()).toBe(0);
    }
  })();
  expect(interrupted.receipt.exitCode).toBe(130);
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
  return interrupted.cancelledMarker;
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

    await withTempDir("niceeval-e2e-docker-profile-", async (defaultRoot) => {
      const defaultSetup = await sudo.run([
        "env", `PATH=${hostPath}`,
        "python3", fixtureScript, "setup",
        "--root", defaultRoot,
        "--scripts", scripts!,
        "--docker-root", dockerInfo.stdout.trim(),
        "--user", user!,
        "--group", group.stdout.trim(),
        "--name", `e2e-setup-prefix-default-${randomUUID()}`,
        "--setup-prefix",
        "--setup-prefix-filesystem-bytes", String(64 * 1024 * 1024),
        "--setup-prefix-slot-count", "1",
        "--setup-prefix-seed-count", "1",
      ], { timeoutMs: 60_000 });
      expect(defaultSetup.exitCode, defaultSetup.diagnostic()).toBe(0);
      const defaultCleanup = await sudo.run([
        "env", `PATH=${hostPath}`,
        "python3", fixtureScript, "cleanup", "--root", defaultRoot,
      ], { timeoutMs: 30_000 });
      expect(defaultCleanup.exitCode, defaultCleanup.diagnostic()).toBe(0);
    });

    await withTempDir("niceeval-e2e-docker-profile-", async (hostRoot) => {
      const profile = `e2e-setup-prefix-${randomUUID()}`;
      let fixture: HostFixture | undefined;
      let primaryError: unknown;
      let coldPrefixMarker: string | undefined;
      let cancelledPrefixMarker: string | undefined;
      let fixedFactsBeforeRestart: readonly JsonRecord[] = [];
      let publishedSeedBeforeRestart: PublishedSeedObservation | undefined;
      const fixedIdentityFacts = async (): Promise<readonly JsonRecord[]> => {
        const script = [
          "import hashlib,json,subprocess,sys",
          "c=json.load(open(sys.argv[1]))",
          "paths=[c['storage']['slotRegistryPath'],c['setupPrefix']['seedRegistryPath']]",
          "records=[]",
          "[records.extend(json.load(open(p)).get('slots',json.load(open(p)).get('seeds',[]))) for p in paths]",
          "out=[]",
          "for r in records:",
          " p=r['imagePath']; u=subprocess.check_output(['blkid','-s','UUID','-o','value',p],text=True).strip().lower()",
          " h=hashlib.sha256(open(p,'rb').read()).hexdigest()",
          " out.append({'id':r.get('slotId',r.get('seedId')),'registryIdentity':r['filesystemIdentity'],'actualUuid':u,'digest':'sha256:'+h,'seed':('seedId' in r)})",
          "print(json.dumps(out))",
        ].join("\n");
        const result = await sudo.run([
          "env", `PATH=${hostPath}`, "python3", "-c", script, fixture!.hostConfig,
        ], { timeoutMs: 30_000 });
        expect(result.exitCode, result.diagnostic()).toBe(0);
        return JSON.parse(result.stdout.trim()) as readonly JsonRecord[];
      };
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
          "--storage-root", join(hostRoot, "nvme-store"),
        ], { timeoutMs: 60_000 });
        expect(setup.exitCode, setup.diagnostic()).toBe(0);
        fixture = JSON.parse(setup.stdout.trim().split("\n").at(-1)!) as HostFixture;

        const activationManifest = join(hostRoot, "journal/fixed-image-v1/activation.json");
        const activationDigest = join(hostRoot, "journal/fixed-image-v1/activation.sha256");
        const activationGeneration = join(hostRoot, "journal/fixed-image-v1");
        const currentPointer = join(activationGeneration, "current");
        const initialEpoch = String((await readFixtureJson(currentPointer)).epoch);
        for (const [label, tamperPath, tamperScript] of [
          ["manifest", activationManifest,
            "import json,sys; p=sys.argv[1]; v=json.load(open(p)); v['epoch']='tampered'; open(p,'w').write(json.dumps(v)+'\\n')"],
          ["digest sidecar", activationDigest,
            "import sys; p=sys.argv[1]; open(p,'w').write('sha256:'+'0'*64+'\\n')"],
          ["host config", fixture.hostConfig,
            "import sys; p=sys.argv[1]; open(p,'ab').write(b' \\n')"],
        ] as const) {
          const backupPath = `${tamperPath}.tamper-backup`;
          const backup = await sudo.run(["cp", "--archive", "--", tamperPath, backupPath]);
          expect(backup.exitCode, backup.diagnostic()).toBe(0);
          const tamper = await sudo.run([
            "python3", "-c", tamperScript, tamperPath,
          ]);
          expect(tamper.exitCode, tamper.diagnostic()).toBe(0);
          const rejected = await sudo.run([
            "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
            "python3", join(scripts!, "watchdog.py"),
            "--control-socket", fixture.controlSocket,
            "--descriptor", fixture.descriptor,
            "--host-config", fixture.hostConfig,
            "--docker-socket", "/run/docker.sock",
            "--journal", fixture.journal,
            "--ready-file", fixture.readyFile,
            "--socket-mode", "0o600",
          ], { timeoutMs: 15_000 });
          expect(rejected.exitCode, `${label} tamper unexpectedly opened admission\n${rejected.diagnostic()}`)
            .not.toBe(0);
          expect(await fileExists(fixture.controlSocket)).toBeUndefined();
          const restore = await sudo.run(["cp", "--archive", "--", backupPath, tamperPath]);
          expect(restore.exitCode, restore.diagnostic()).toBe(0);
          const removeBackup = await sudo.run(["unlink", "--", backupPath]);
          expect(removeBackup.exitCode, removeBackup.diagnostic()).toBe(0);
          const rebound = await sudo.run([
            "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
            "python3", join(scripts!, "activate-fixed-images.py"),
            "--host-config", fixture.hostConfig,
            "--descriptor", fixture.descriptor,
            "--lock", join(hostRoot, "activation.lock"),
          ], { timeoutMs: 60_000 });
          expect(rebound.exitCode, rebound.diagnostic()).toBe(0);
        }

        const activationArgv = [
          "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
          "python3", join(scripts!, "activate-fixed-images.py"),
          "--host-config", fixture.hostConfig,
          "--descriptor", fixture.descriptor,
          "--lock", join(hostRoot, "activation.lock"),
        ];
        const dataMount = join(hostRoot, "data");
        const ownerFile = join(dataMount, "activation-owner.bin");
        const holderCases = [
          {
            label: "cwd",
            script: "import os,sys,time; os.chdir(sys.argv[1]); open(sys.argv[2],'w').write('ready'); time.sleep(60)",
          },
          {
            label: "fd",
            script: "import sys,time; f=open(sys.argv[1],'ab'); open(sys.argv[2],'w').write('ready'); time.sleep(60)",
          },
          {
            label: "maps",
            script: "import mmap,os,sys,time; f=open(sys.argv[1],'w+b'); f.truncate(4096); m=mmap.mmap(f.fileno(),4096); open(sys.argv[2],'w').write('ready'); time.sleep(60)",
          },
          {
            label: "root",
            script: "import os,sys,time; marker=open(sys.argv[2],'w'); os.chroot(sys.argv[1]); os.chdir('/'); marker.write('ready'); marker.flush(); time.sleep(60)",
          },
        ] as const;
        for (const holder of holderCases) {
          const ready = join(hostRoot, `owner-${holder.label}.ready`);
          await withProcess(
            ["sudo", "-n", "python3", "-c", holder.script,
              holder.label === "cwd" || holder.label === "root" ? dataMount : ownerFile, ready],
            { processGroup: true, timeoutMs: 15_000, graceMs: 2_000 },
            async (process) => {
              await Promise.race([
                pollUntil(() => fileExists(ready), {
                  timeoutMs: 5_000, intervalMs: 50, label: `${holder.label} storage owner ready`,
                }),
                process.done.then((receipt) => {
                  throw new Error(`${holder.label} storage owner exited early\n${receipt.diagnostic()}`);
                }),
              ]);
              const rejected = await sudo.run(activationArgv, { timeoutMs: 15_000 });
              expect(rejected.exitCode, `${holder.label} owner did not block activation\n${rejected.diagnostic()}`)
                .not.toBe(0);
              expect(rejected.stderr).toMatch(/process ownership of profile storage|mapped profile storage/u);
            },
          );
        }

        await withProcess(
          [
            "sudo", "-n", "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
            "NICEEVAL_TEST_DROP_CAPTURE_PUBLISH_RESPONSE_ONCE=1",
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

            const onlineActivation = await sudo.run(activationArgv, { timeoutMs: 15_000 });
            expect(
              onlineActivation.exitCode,
              `an online watchdog must keep the alias lock and admission closed to activation\n${onlineActivation.diagnostic()}`,
            ).not.toBe(0);

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

            cancelledPrefixMarker = await interruptProfileCapture(root, hostRoot, fixture!, profile);
            const cancellationLedger = await setupPrefixLedgerEvents(fixture!.journal);
            const cancelFence = cancellationLedger.findLast((event) =>
              event.event === "setup-prefix-capture-cancel-fenced" &&
              (event.operationIds?.length ?? 0) === 1);
            expect(cancelFence?.operationIds).toHaveLength(1);
            const cancelledOperationId = cancelFence!.operationIds![0]!;
            expect(cancellationLedger).toEqual(expect.arrayContaining([
              expect.objectContaining({
                event: "setup-prefix-capture-failed",
                operationId: cancelledOperationId,
                seedScrubbed: true,
              }),
            ]));
            expect(cancellationLedger.some((event) =>
              event.event === "setup-prefix-captured" && event.operationId === cancelledOperationId),
            "cancel-fenced is a scrubbed terminal and must never be published or reported as ambiguity")
              .toBe(false);
            const coldRun = await invokeProfile(root, hostRoot, fixture!, profile, "v1", "PUBLIC_MODE=alpha\n");
            expect(
              coldRun.execution,
              "the first fixed Profile retry after cancellation must replay A instead of restoring a cancelled publish",
            ).toContain("niceeval.e2e.setup-prefix-role=docker-data-prefix");
            const cold = coldRun.evidence;
            coldPrefixMarker = cold.dockerDataPrefixMarker;
            const responseLossLedger = await setupPrefixLedgerEvents(fixture!.journal);
            const capturedEvents = responseLossLedger.filter((event) => event.event === "setup-prefix-captured");
            expect(capturedEvents).toHaveLength(1);
            const reconciledOperationId = capturedEvents[0]!.operationId;
            expect(reconciledOperationId).toMatch(/^setup-prefix-[0-9a-f-]{36}$/u);
            expect(responseLossLedger.filter((event) =>
              event.operationId === reconciledOperationId && event.event === "setup-prefix-capture-prepared"))
              .toHaveLength(1);
            expect(responseLossLedger.filter((event) =>
              event.operationId === reconciledOperationId && event.event === "setup-prefix-captured"))
              .toHaveLength(1);
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
            expect(cold.dockerDataPrefixMarker).not.toBe(cancelledPrefixMarker);
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

            const runHeldPreparedCapture = async (
              label: string,
              onPrepared: (input: {
                readonly invocation: ProcessHandle;
                readonly operationId: string;
                releasePreparedResponse(): Promise<void>;
              }) => Promise<unknown>,
            ): Promise<string> => withProjectCopy(projectCopy, async ({ root: heldRoot }) => {
              await copyPreparedProfileBuildContext(root, heldRoot);
              await appendFile(
                join(heldRoot, "evals/setup-prefix-cache.eval.ts"),
                `\n// prepared-race cold source ${label}-${randomUUID()}\n`,
              );
              const experimentPath = join(heldRoot, "experiments/setup-prefix-cache.ts");
              const originalExperiment = await readFile(experimentPath, "utf8");
              const token = randomUUID().replaceAll("-", "");
              const changedExperiment = originalExperiment.replace(
                "docker volume create --label niceeval.e2e.setup-prefix-role=docker-data-prefix ",
                `docker volume create --label niceeval.e2e.setup-prefix-role=docker-data-prefix ` +
                  `--label niceeval.e2e.prepared-race=${label}-${token} `,
              );
              expect(changedExperiment).not.toBe(originalExperiment);
              await writeFile(experimentPath, changedExperiment, "utf8");

              const proxyReady = join(hostRoot, "control-proxy.ready");
              const preparedReceipt = join(hostRoot, "control-proxy.prepared.json");
              const releaseReceipt = join(hostRoot, "control-proxy.release");
              const proxyResult = await withProcess(
                [
                  "sudo", "-n", "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
                  "python3", fixtureScript, "proxy-prepared-response", "--root", hostRoot,
                ],
                { processGroup: true, timeoutMs: 300_000, graceMs: 5_000 },
                async (proxy) => {
                  await pollUntil(() => fileExists(proxyReady), {
                    timeoutMs: 10_000,
                    intervalMs: 25,
                    label: `${label} prepared-response proxy readiness`,
                  });
                  const operationId = await withProcess(
                    [
                      "docker", "run", "--rm", "--network", "none", "--user", "0:0",
                      "--mount", `type=bind,src=${process.cwd()},dst=${process.cwd()},readonly`,
                      "--mount", `type=bind,src=${heldRoot},dst=${heldRoot}`,
                      "--mount", `type=bind,src=${hostRoot},dst=${hostRoot}`,
                      "--mount", "type=bind,src=/run/docker.sock,dst=/run/docker.sock",
                      "--workdir", heldRoot,
                      "--env", `NICEEVAL_E2E_DOCKER_PROFILE_ALIAS=${profile}`,
                      "--env", "NICEEVAL_E2E_SETUP_PREFIX_MODE=profile-full-copy",
                      "--env", "NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV=PUBLIC_MODE=alpha\n",
                      "--env", `XDG_STATE_HOME=${join(hostRoot, `state-${label}`)}`,
                      nodeImage,
                      "sh", "-ec",
                      `${profileRegistrySetup(fixture!, profile, hostRoot)}
exec node_modules/.bin/niceeval exp setup-prefix-cache --rerun all --json`,
                    ],
                    { processGroup: true, timeoutMs: 240_000, graceMs: 10_000 },
                    async (invocation) => {
                      const prepared = await Promise.race([
                        pollUntil(async () => {
                        if (!(await fileExists(preparedReceipt))) return undefined;
                        return JSON.parse(await readFile(preparedReceipt, "utf8")) as JsonRecord;
                        }, {
                          timeoutMs: 180_000,
                          intervalMs: 25,
                          label: `${label} Host prepared capture`,
                        }),
                        invocation.done.then((receipt) => {
                          throw new Error(
                            `${label} invocation ended before Host prepared response: ${receipt.diagnostic()}`,
                          );
                        }),
                      ]);
                      expect(prepared.operationId).toMatch(/^setup-prefix-[0-9a-f-]{36}$/u);
                      const id = String(prepared.operationId);
                      await onPrepared({
                        invocation,
                        operationId: id,
                        releasePreparedResponse: () => writeFile(releaseReceipt, "release\n", "utf8"),
                      });
                      return id;
                    },
                  );
                  expect(proxy.signal("SIGTERM")).toBe(true);
                  return operationId;
                },
              );
              const ownership = await sudo.run([
                "chown", "-R", `${process.getuid!()}:${process.getgid!()}`, join(heldRoot, ".niceeval"),
              ]);
              expect(ownership.exitCode, ownership.diagnostic()).toBe(0);
              return proxyResult;
            });

            const releasedPreparedOperation = await runHeldPreparedCapture(
              "prepared-release",
              async ({ invocation }) => {
                expect(invocation.signal("SIGINT")).toBe(true);
                const receipt = await invocation.done;
                expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
                expect(receipt.expReceipt(), receipt.diagnostic()).toMatchObject({ completion: "interrupted" });
              },
            );
            await pollUntil(async () => {
              const events = await setupPrefixLedgerEvents(fixture!.journal);
              return events.some((event) =>
                event.event === "setup-prefix-capture-cancelled" &&
                event.operationId === releasedPreparedOperation && event.seedScrubbed)
                ? true
                : undefined;
            }, { timeoutMs: 30_000, intervalMs: 50, label: "prepared capture release scrub terminal" });

            const publishReleaseOperation = await runHeldPreparedCapture(
              "publish-release-race",
              async ({ invocation, releasePreparedResponse }) => {
                await releasePreparedResponse();
                expect(invocation.signal("SIGINT")).toBe(true);
                const receipt = await invocation.done;
                expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
              },
            );
            const publishReleaseEvents = (await setupPrefixLedgerEvents(fixture!.journal))
              .filter((event) => event.operationId === publishReleaseOperation);
            const publishedWon = publishReleaseEvents.some((event) => event.event === "setup-prefix-captured");
            const releaseWon = publishReleaseEvents.some((event) =>
              event.event === "setup-prefix-capture-cancelled" && event.seedScrubbed);
            expect(
              Number(publishedWon) + Number(releaseWon),
              `publish/release must select exactly one durable terminal: ${JSON.stringify(publishReleaseEvents)}`,
            ).toBe(1);

            const crashedPreparedOperation = await runHeldPreparedCapture(
              "prepared-watchdog-crash",
              async ({ invocation }) => {
                expect(watchdog.pid).toBeTypeOf("number");
                const crashed = await sudo.run(["kill", "-KILL", "--", `-${watchdog.pid!}`]);
                expect(crashed.exitCode, crashed.diagnostic()).toBe(0);
                await watchdog.done;
                expect(invocation.signal("SIGINT")).toBe(true);
                await invocation.done;
              },
            );
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
              { processGroup: true, timeoutMs: 90_000, graceMs: 5_000 },
              async (recoveryWatchdog) => {
                await Promise.race([
                  pollUntil(async () => {
                    const events = await setupPrefixLedgerEvents(fixture!.journal);
                    return events.some((event) =>
                      event.event === "setup-prefix-capture-recovered" &&
                      event.operationId === crashedPreparedOperation && event.seedScrubbed)
                      ? true
                      : undefined;
                  }, {
                    timeoutMs: 30_000,
                    intervalMs: 100,
                    label: "watchdog recovery after prepared crash",
                  }),
                  recoveryWatchdog.done.then((receipt) => {
                    throw new Error(`recovery watchdog exited before prepared scrub\n${receipt.diagnostic()}`);
                  }),
                ]);
                const crashEvents = await setupPrefixLedgerEvents(fixture!.journal);
                expect(crashEvents).toContainEqual(expect.objectContaining({
                  event: "setup-prefix-capture-recovered",
                  operationId: crashedPreparedOperation,
                  seedScrubbed: true,
                }));
                expect(crashEvents.some((event) =>
                  event.event === "setup-prefix-captured" && event.operationId === crashedPreparedOperation))
                  .toBe(false);
                await pollUntil(async () => {
                  const observation = await setupPrefixHostObservation(fixture!.journal);
                  if (!observation.settled) return undefined;
                  return (await profileRuntimeResources(fixture!.profileId)).length === 0 ? true : undefined;
                }, {
                  timeoutMs: 30_000,
                  intervalMs: 100,
                  label: "watchdog reconciliation after prepared crash",
                });
                await recoveryWatchdog.dispose();
              },
            );
            fixedFactsBeforeRestart = await fixedIdentityFacts();
            publishedSeedBeforeRestart = await publishedSeedObservation(
              fixture!.journal,
              cold.dockerDataPrefixMarker,
            );
            expect(publishedSeedBeforeRestart.marker).toBe(cold.dockerDataPrefixMarker);
            expect(publishedSeedBeforeRestart.marker).not.toBe(cancelledPrefixMarker);
          },
        );

        const residueToken = randomUUID().replaceAll("-", "");
        const residueCases = [
          {
            label: "container",
            create: ["create", "--label", `niceeval.profile-id=${fixture.profileId}`,
              "--name", `niceeval-activation-${residueToken}`, nodeImage, "true"],
            remove: (id: string) => ["rm", "--force", id],
          },
          {
            label: "network",
            create: ["network", "create", "--label", `niceeval.profile-id=${fixture.profileId}`,
              `niceeval-activation-${residueToken}`],
            remove: (id: string) => ["network", "rm", id],
          },
          {
            label: "volume",
            create: ["volume", "create", "--label", `niceeval.profile-id=${fixture.profileId}`,
              `niceeval-activation-${residueToken}`],
            remove: (id: string) => ["volume", "rm", "--force", id],
          },
          {
            label: "builder state volume",
            create: ["volume", "create", `buildx_buildkit_niceeval-build-${residueToken.slice(0, 24)}0_state`],
            remove: (id: string) => ["volume", "rm", "--force", id],
          },
          {
            label: "builder container",
            create: ["create", "--name", `buildx_buildkit_niceeval-build-${residueToken.slice(0, 24)}0`,
              nodeImage, "true"],
            remove: (id: string) => ["rm", "--force", id],
          },
        ] as const;
        for (const residue of residueCases) {
          const created = await docker.run(residue.create);
          expect(created.exitCode, created.diagnostic()).toBe(0);
          const identity = created.stdout.trim();
          try {
            const rejected = await sudo.run(activationArgv, { timeoutMs: 15_000 });
            expect(rejected.exitCode, `${residue.label} residue did not block activation\n${rejected.diagnostic()}`)
              .not.toBe(0);
          } finally {
            const removed = await docker.run(residue.remove(identity));
            expect(removed.exitCode, removed.diagnostic()).toBe(0);
          }
        }
        const provisionalRef = `niceeval-build-provisional:${residueToken}`;
        const tagProvisional = await docker.run(["tag", nodeImage, provisionalRef]);
        expect(tagProvisional.exitCode, tagProvisional.diagnostic()).toBe(0);
        try {
          const rejected = await sudo.run(activationArgv, { timeoutMs: 15_000 });
          expect(rejected.exitCode, `provisional image residue did not block activation\n${rejected.diagnostic()}`)
            .not.toBe(0);
        } finally {
          const removed = await docker.run(["image", "rm", provisionalRef]);
          expect(removed.exitCode, removed.diagnostic()).toBe(0);
        }

        const activeImageSource = await docker.run(["create", nodeImage, "true"]);
        expect(activeImageSource.exitCode, activeImageSource.diagnostic()).toBe(0);
        const activeImageRef = `niceeval-activation-active:${residueToken}`;
        try {
          const committed = await docker.run([
            "commit", "--change", `LABEL niceeval.profile-id=${fixture.profileId}`,
            activeImageSource.stdout.trim(), activeImageRef,
          ]);
          expect(committed.exitCode, committed.diagnostic()).toBe(0);
          const rejected = await sudo.run(activationArgv, { timeoutMs: 15_000 });
          expect(rejected.exitCode, `profile-owned image residue did not block activation\n${rejected.diagnostic()}`)
            .not.toBe(0);
        } finally {
          const removeContainer = await docker.run(["rm", "--force", activeImageSource.stdout.trim()]);
          expect(removeContainer.exitCode, removeContainer.diagnostic()).toBe(0);
          const removeImage = await docker.run(["image", "rm", "--force", activeImageRef]);
          expect(removeImage.exitCode, removeImage.diagnostic()).toBe(0);
        }

        for (const journalPath of [join(hostRoot, "journal/events.ndjson"), fixture.journal]) {
          for (const [kind, state] of [
            ["lease", { leases: { "unfinished-lease": { state: "active" } } }],
            ["reservation", { reservations: { "unfinished-reservation": { state: "granted" } } }],
            ["build", { reservations: { "unfinished-build": { kind: "build", state: "provisioning" } } }],
          ] as const) {
            const backup = `${journalPath}.${kind}.backup`;
            const existed = await fixtureHostFileExists(journalPath);
            if (existed) {
              const copied = await sudo.run(["cp", "--archive", "--", journalPath, backup]);
              expect(copied.exitCode, copied.diagnostic()).toBe(0);
            }
            const injected = await sudo.run([
              "python3", "-c",
              "import json,pathlib,sys; p=pathlib.Path(sys.argv[1]); p.parent.mkdir(parents=True,exist_ok=True); p.open('a').write(json.dumps({'state':json.loads(sys.argv[2])})+'\\n')",
              journalPath, JSON.stringify(state),
            ]);
            expect(injected.exitCode, injected.diagnostic()).toBe(0);
            const rejected = await sudo.run(activationArgv, { timeoutMs: 15_000 });
            expect(
              rejected.exitCode,
              `${kind} in ${journalPath} did not block activation\n${rejected.diagnostic()}`,
            ).not.toBe(0);
            const restored = existed
              ? await sudo.run(["mv", "--force", "--", backup, journalPath])
              : await sudo.run(["unlink", "--", journalPath]);
            expect(restored.exitCode, restored.diagnostic()).toBe(0);
            expect(await fixtureHostFileExists(journalPath)).toBe(existed);
            if (journalPath === fixture.journal) {
              expect(existed, "the fixed-image ownership journal must not disappear during residue injection")
                .toBe(true);
              expect(await publishedSeedObservation(journalPath, coldPrefixMarker))
                .toEqual(publishedSeedBeforeRestart);
            }
          }
        }

        const detachedSource = await docker.run(["create", nodeImage, "true"]);
        expect(detachedSource.exitCode, detachedSource.diagnostic()).toBe(0);
        const detachedRef = `niceeval-activation-detached:${residueToken}`;
        try {
          const committed = await docker.run([
            "commit",
            "--change", `LABEL niceeval.profile-id=${fixture.profileId}`,
            "--change", "LABEL niceeval.ownership-class=detached-cache/v1",
            detachedSource.stdout.trim(), detachedRef,
          ]);
          expect(committed.exitCode, committed.diagnostic()).toBe(0);
          const allowed = await sudo.run(activationArgv, { timeoutMs: 60_000 });
          expect(allowed.exitCode, allowed.diagnostic()).toBe(0);
          const manifest = JSON.parse(await readFixtureHostFile(activationManifest)) as JsonRecord;
          expect(manifest.detachedRealizations).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "image" }),
          ]));
        } finally {
          const removeContainer = await docker.run(["rm", "--force", detachedSource.stdout.trim()]);
          expect(removeContainer.exitCode, removeContainer.diagnostic()).toBe(0);
          const removeImage = await docker.run(["image", "rm", "--force", detachedRef]);
          expect(removeImage.exitCode, removeImage.diagnostic()).toBe(0);
        }

        const reactivate = await sudo.run([
          "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
          "python3", join(scripts!, "activate-fixed-images.py"),
          "--host-config", fixture.hostConfig,
          "--descriptor", fixture.descriptor,
          "--lock", join(hostRoot, "activation.lock"),
        ], { timeoutMs: 60_000 });
        expect(reactivate.exitCode, reactivate.diagnostic()).toBe(0);
        const fixedFactsAfterRestart = await fixedIdentityFacts();
        expect(fixedFactsAfterRestart.map((fact) => fact.actualUuid))
          .toEqual(fixedFactsBeforeRestart.map((fact) => fact.actualUuid));
        expect(new Set(fixedFactsAfterRestart.map((fact) => fact.actualUuid)).size)
          .toBe(fixedFactsAfterRestart.length);
        for (const fact of fixedFactsAfterRestart) {
          expect(fact.registryIdentity).toBe(`ext4-uuid:${String(fact.actualUuid)}`);
        }
        expect(fixedFactsAfterRestart.filter((fact) => fact.seed).map((fact) => fact.digest))
          .toEqual(fixedFactsBeforeRestart.filter((fact) => fact.seed).map((fact) => fact.digest));
        const publishedSeedAfterRestart = await publishedSeedObservation(
          fixture.journal,
          coldPrefixMarker,
        );
        expect(publishedSeedAfterRestart).toEqual(publishedSeedBeforeRestart);

        let watchdogStoppedForAmbiguity = false;
        await withProcess(
          [
            "sudo", "-n", "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
            "NICEEVAL_TEST_DROP_CAPTURE_PUBLISH_RESPONSE_ONCE=1",
            "python3", join(scripts!, "watchdog.py"),
            "--control-socket", fixture.controlSocket,
            "--descriptor", fixture.descriptor,
            "--host-config", fixture.hostConfig,
            "--docker-socket", "/run/docker.sock",
            "--journal", fixture.journal,
            "--ready-file", fixture.readyFile,
            "--socket-mode", "0o600",
          ],
          { processGroup: true, timeoutMs: 180_000, graceMs: 5_000 },
          async (restartedWatchdog) => {
            await Promise.race([
              pollUntil(() => fileExists(fixture!.readyFile), {
                timeoutMs: 15_000, intervalMs: 100, label: "restarted fixed watchdog ready file",
              }),
              restartedWatchdog.done.then((receipt) => {
                throw new Error(`restarted watchdog exited before readiness\n${receipt.diagnostic()}`);
              }),
            ]);
            const afterRestart = await withProjectCopy(projectCopy, async ({ root: restartReaderRoot }) => {
              await copyPreparedProfileBuildContext(root, restartReaderRoot);
              await copyFile(
                join(root, "evals/setup-prefix-cache.eval.ts"),
                join(restartReaderRoot, "evals/setup-prefix-cache.eval.ts"),
              );
              return invokeProfile(
                root, hostRoot, fixture!, profile, "v2", "PUBLIC_MODE=beta\n", restartReaderRoot,
              );
            });
            const restartLedger = await setupPrefixLedgerEvents(fixture!.journal);
            const restore = await latestSetupPrefixRestore(fixture!.journal);
            expect(restore).toMatchObject({
              sourceSeedId: publishedSeedAfterRestart.seedId,
              sourceArtifactId: publishedSeedAfterRestart.artifactId,
              targetSlotId: expect.any(String),
              restoredSlotDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            });
            expect(
              afterRestart.evidence.dockerDataPrefixMarker,
              `watchdog restart must restore the published immutable seed; ` +
                `setupPrefixKeys=${JSON.stringify(afterRestart.setupPrefixKeys)}; ` +
                `host ledger=${JSON.stringify(restartLedger)}`,
            ).toBe(coldPrefixMarker);
            expect(afterRestart.evidence.dockerDataPrefixMarker).not.toBe(cancelledPrefixMarker);

            await withProjectCopy(projectCopy, async ({ root: ambiguityRoot }) => {
              try {
                await copyPreparedProfileBuildContext(root, ambiguityRoot);
                const experimentPath = join(ambiguityRoot, "experiments/setup-prefix-cache.ts");
                const originalExperiment = await readFile(experimentPath, "utf8");
                const ambiguityToken = randomUUID().replaceAll("-", "");
                const changedExperiment = originalExperiment
                  .replace(
                    "docker volume create --label niceeval.e2e.setup-prefix-role=docker-data-prefix ",
                    `docker volume create --label niceeval.e2e.setup-prefix-role=docker-data-prefix --label niceeval.e2e.ambiguity=${ambiguityToken} `,
                  )
                  .replace("attempts: 1,\n  maxConcurrency: 1,", "attempts: 3,\n  maxConcurrency: 1,");
                expect(changedExperiment).not.toBe(originalExperiment);
                await writeFile(experimentPath, changedExperiment, "utf8");
                const capturedBefore = (await setupPrefixLedgerEvents(fixture!.journal))
                  .filter((event) => event.event === "setup-prefix-captured").length;
                const unreachableStartedAt = Date.now();
                const incomplete = await withProcess(
                  [
                    "docker", "run", "--rm", "--network", "none", "--user", "0:0",
                    "--mount", `type=bind,src=${process.cwd()},dst=${process.cwd()},readonly`,
                    "--mount", `type=bind,src=${ambiguityRoot},dst=${ambiguityRoot}`,
                    "--mount", `type=bind,src=${hostRoot},dst=${hostRoot}`,
                    "--mount", "type=bind,src=/run/docker.sock,dst=/run/docker.sock",
                    "--workdir", ambiguityRoot,
                    "--env", `NICEEVAL_E2E_DOCKER_PROFILE_ALIAS=${profile}`,
                    "--env", "NICEEVAL_E2E_SETUP_PREFIX_MODE=profile-full-copy",
                    "--env", "NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV=PUBLIC_MODE=alpha\n",
                    "--env", `XDG_STATE_HOME=${join(hostRoot, "state-ambiguity")}`,
                    nodeImage,
                    "sh", "-ec",
                    `${profileRegistrySetup(fixture!, profile, hostRoot)}
  exec node_modules/.bin/niceeval exp setup-prefix-cache --rerun all --json`,
                  ],
                  { processGroup: true, timeoutMs: 180_000, graceMs: 10_000 },
                  async (invocation) => {
                    await pollUntil(
                      async () => {
                        const events = await setupPrefixLedgerEvents(fixture!.journal);
                        return events.filter((event) => event.event === "setup-prefix-captured").length > capturedBefore
                          ? true
                          : undefined;
                      },
                      { timeoutMs: 90_000, intervalMs: 10, label: "committed capture with lost caller response" },
                    );
                    await restartedWatchdog.dispose();
                    watchdogStoppedForAmbiguity = true;
                    // The three independent publish reconciliations exhaust quickly even
                    // though prepare/copy retains its long production budget. Restart only
                    // after that bounded window so Scope cleanup can prove reservation release.
                    await new Promise((resolve) => setTimeout(resolve, 2_000));
                    return withProcess(
                      [
                        "sudo", "-n", "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
                        "python3", join(scripts!, "watchdog.py"),
                        "--control-socket", fixture!.controlSocket,
                        "--descriptor", fixture!.descriptor,
                        "--host-config", fixture!.hostConfig,
                        "--docker-socket", "/run/docker.sock",
                        "--journal", fixture!.journal,
                        "--ready-file", fixture!.readyFile,
                        "--socket-mode", "0o600",
                      ],
                      { processGroup: true, timeoutMs: 90_000, graceMs: 5_000 },
                      async (cleanupWatchdog) => {
                        await pollUntil(() => fileExists(fixture!.readyFile), {
                          timeoutMs: 15_000,
                          intervalMs: 100,
                          label: "watchdog ready for incomplete Invocation cleanup",
                        });
                        const receipt = await invocation.done;
                        await cleanupWatchdog.dispose();
                        return receipt;
                      },
                    );
                  },
                );
                expect(Date.now() - unreachableStartedAt).toBeLessThan(45_000);
                expect(incomplete.exitCode, incomplete.diagnostic()).not.toBe(0);
                const publicDiagnostic = `${incomplete.stdout}\n${incomplete.stderr}`;
                expect(publicDiagnostic).toContain("sandbox-environment-incomplete");
                expect(publicDiagnostic).toMatch(/setup-prefix-[0-9a-f-]{36}/u);
                expect(publicDiagnostic).toContain(`niceeval docker profile doctor ${profile}`);
                expect(publicDiagnostic).not.toContain(hostRoot);
                expect(incomplete.expReceipt(), incomplete.diagnostic()).toMatchObject({ completion: "completed" });
                expect(
                  only(
                    incomplete.expEvalEvents(),
                    (event) => event.evalId === "setup-prefix-cache",
                    incomplete.diagnostic(),
                  ),
                ).toMatchObject({
                  verdict: "errored",
                  attempts: 1,
                  planned: 3,
                  unstarted: 2,
                  reason: "early_exit",
                });
                expect((await setupPrefixLedgerEvents(fixture!.journal))
                  .filter((event) => event.event === "setup-prefix-captured").length - capturedBefore)
                  .toBe(1);
              } finally {
                const ownership = await sudo.run([
                  "chown", "-R", `${process.getuid!()}:${process.getgid!()}`, join(ambiguityRoot, ".niceeval"),
                ]);
                expect(ownership.exitCode, ownership.diagnostic()).toBe(0);
              }
            });
          },
        );
        if (watchdogStoppedForAmbiguity) {
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
            { processGroup: true, timeoutMs: 60_000, graceMs: 5_000 },
            async (recoveryWatchdog) => {
              await pollUntil(
                async () => (await setupPrefixHostObservation(fixture!.journal)).settled ? true : undefined,
                { timeoutMs: 30_000, intervalMs: 100, label: "watchdog restart reconciliation after ambiguity" },
              );
              await recoveryWatchdog.dispose();
            },
          );
        }

        const administrativeArgv = (...mode: readonly string[]): readonly string[] => [
          ...activationArgv,
          ...mode,
        ];
        const runAdministrative = async (
          label: string,
          mode: readonly string[],
          timeoutMs = 180_000,
        ): Promise<string> => {
          const receipt = await sudo.run(administrativeArgv(...mode), { timeoutMs });
          expect(receipt.exitCode, `${label} failed\n${receipt.diagnostic()}`).toBe(0);
          return receipt.stdout;
        };
        const committedEpoch = async (): Promise<string> =>
          String((await readFixtureJson(currentPointer)).epoch);
        const capsuleConfig = async (epoch: string): Promise<JsonRecord> =>
          readFixtureJson(join(activationGeneration, "epochs", epoch, "config.json"));

        await runAdministrative("first seed rotation", [
          "--rotate-seeds",
          "--prepare-store",
          "--prepare-helper", join(scripts!, "prepare-loop-storage.sh"),
        ]);
        const firstRotatedEpoch = await committedEpoch();
        expect(firstRotatedEpoch).not.toBe(initialEpoch);
        const firstRotatedConfig = await capsuleConfig(firstRotatedEpoch);
        expect(isRecord(firstRotatedConfig.storage)).toBe(true);
        const firstRotatedOuter = String((firstRotatedConfig.storage as JsonRecord).outerImagePath);
        expect(firstRotatedOuter).toContain(`/fixed-image-v1/rotation-epochs/${firstRotatedEpoch}/store.img`);

        await runAdministrative("second seed rotation", [
          "--rotate-seeds",
          "--prepare-store",
          "--prepare-helper", join(scripts!, "prepare-loop-storage.sh"),
        ]);
        const secondRotatedEpoch = await committedEpoch();
        expect(secondRotatedEpoch).not.toBe(firstRotatedEpoch);

        await runAdministrative("cold rollback to the original committed capsule", [
          "--rollback-to", initialEpoch,
        ]);
        const rollbackEpoch = await committedEpoch();
        expect(rollbackEpoch).not.toBe(initialEpoch);
        const rollbackManifest = await readFixtureJson(activationManifest);
        expect(rollbackManifest).toMatchObject({
          epoch: rollbackEpoch,
          previousEpoch: secondRotatedEpoch,
          outerImagePath: String(((await capsuleConfig(initialEpoch)).storage as JsonRecord).outerImagePath),
        });
        const rolledBackDescriptor = await readFixtureJson(fixture.descriptor);
        const originalDescriptor = await readFixtureJson(
          join(activationGeneration, "epochs", initialEpoch, "descriptor.json"),
        );
        expect(rolledBackDescriptor).toEqual(originalDescriptor);

        const statusBeforeRetire = JSON.parse(await runAdministrative(
          "epoch status before retirement",
          ["--status"],
        )) as JsonRecord;
        expect(statusBeforeRetire).toMatchObject({
          schema: "niceeval-docker-profile-epoch-capacity/v1",
          currentEpoch: rollbackEpoch,
          activeSeedRemaining: expect.any(Number),
          retainedEpochBytes: expect.any(Number),
          retirableBytes: expect.any(Number),
          reclaimableBytes: 0,
          epochs: expect.arrayContaining([
            expect.objectContaining({ epoch: firstRotatedEpoch, state: "retained" }),
            expect.objectContaining({ epoch: secondRotatedEpoch, state: "previous" }),
            expect.objectContaining({ epoch: rollbackEpoch, state: "current" }),
          ]),
        });

        await runAdministrative("retire the old rotated epoch", ["--retire-epoch", firstRotatedEpoch]);
        const tombstone = join(activationGeneration, "retired", `${firstRotatedEpoch}.json`);
        expect(await readFixtureJson(tombstone)).toMatchObject({
          schema: "niceeval-docker-profile-epoch-retirement/v1",
          epoch: firstRotatedEpoch,
          outerImagePath: firstRotatedOuter,
          coldRollbackAvailable: false,
        });

        const reclaimDetachedSource = await docker.run(["create", nodeImage, "true"]);
        expect(reclaimDetachedSource.exitCode, reclaimDetachedSource.diagnostic()).toBe(0);
        const reclaimDetachedRef = `niceeval-epoch-reclaim-detached:${randomUUID()}`;
        try {
          const detached = await docker.run([
            "commit",
            "--change", `LABEL niceeval.profile-id=${fixture.profileId}`,
            "--change", "LABEL niceeval.ownership-class=detached-cache/v1",
            reclaimDetachedSource.stdout.trim(), reclaimDetachedRef,
          ]);
          expect(detached.exitCode, detached.diagnostic()).toBe(0);
          const rejected = await sudo.run(administrativeArgv("--reclaim-epoch", firstRotatedEpoch), {
            timeoutMs: 30_000,
          });
          expect(rejected.exitCode, `detached cache did not block reclaim\n${rejected.diagnostic()}`).not.toBe(0);
          expect(rejected.stderr).toContain("detached-cache ownership references");
        } finally {
          expect((await docker.run(["rm", "--force", reclaimDetachedSource.stdout.trim()])).exitCode).toBe(0);
          expect((await docker.run(["image", "rm", "--force", reclaimDetachedRef])).exitCode).toBe(0);
        }

        const journalPath = join(activationGeneration, "events.ndjson");
        const journalBackup = `${journalPath}.reclaim-backup`;
        expect((await sudo.run(["cp", "--archive", "--", journalPath, journalBackup])).exitCode).toBe(0);
        try {
          const injected = await sudo.run([
            "python3", "-c",
            "import json,sys; open(sys.argv[1],'a').write(json.dumps({'state':{'artifactEpoch':sys.argv[2]}})+'\\n')",
            journalPath, firstRotatedEpoch,
          ]);
          expect(injected.exitCode, injected.diagnostic()).toBe(0);
          const rejected = await sudo.run(administrativeArgv("--reclaim-epoch", firstRotatedEpoch), {
            timeoutMs: 30_000,
          });
          expect(rejected.exitCode, `active artifact journal did not block reclaim\n${rejected.diagnostic()}`)
            .not.toBe(0);
          expect(rejected.stderr).toContain("active artifact or journal ownership references");
        } finally {
          expect((await sudo.run(["mv", "--force", "--", journalBackup, journalPath])).exitCode).toBe(0);
        }

        const extraCapsule = join(activationGeneration, "epochs", `reference-${randomUUID()}`);
        expect((await sudo.run([
          "cp", "--archive", "--",
          join(activationGeneration, "epochs", firstRotatedEpoch), extraCapsule,
        ])).exitCode).toBe(0);
        try {
          const rejected = await sudo.run(administrativeArgv("--reclaim-epoch", firstRotatedEpoch), {
            timeoutMs: 30_000,
          });
          expect(rejected.exitCode, `retained capsule did not block reclaim\n${rejected.diagnostic()}`).not.toBe(0);
          expect(rejected.stderr).toContain("another retained capsule references the retired backing");
        } finally {
          expect((await sudo.run([
            "python3", "-c", "import shutil,sys; shutil.rmtree(sys.argv[1])", extraCapsule,
          ])).exitCode).toBe(0);
        }

        const loop = await sudo.run(["losetup", "--find", "--show", firstRotatedOuter]);
        expect(loop.exitCode, loop.diagnostic()).toBe(0);
        try {
          const rejected = await sudo.run(administrativeArgv("--reclaim-epoch", firstRotatedEpoch), {
            timeoutMs: 30_000,
          });
          expect(rejected.exitCode, `loop reference did not block reclaim\n${rejected.diagnostic()}`).not.toBe(0);
          expect(rejected.stderr).toContain("loop or mount reference");
        } finally {
          expect((await sudo.run(["losetup", "--detach", loop.stdout.trim()])).exitCode).toBe(0);
        }

        const processReady = join(hostRoot, "reclaim-process.ready");
        await withProcess(
          [
            "sudo", "-n", "python3", "-c",
            "import sys,time; f=open(sys.argv[1],'rb'); open(sys.argv[2],'w').write('ready'); time.sleep(60)",
            firstRotatedOuter, processReady,
          ],
          { processGroup: true, timeoutMs: 15_000, graceMs: 2_000 },
          async (holder) => {
            await Promise.race([
              pollUntil(() => fileExists(processReady), {
                timeoutMs: 5_000, intervalMs: 50, label: "retired epoch process reference",
              }),
              holder.done.then((receipt) => {
                throw new Error(`retired epoch process holder exited early\n${receipt.diagnostic()}`);
              }),
            ]);
            const rejected = await sudo.run(administrativeArgv("--reclaim-epoch", firstRotatedEpoch), {
              timeoutMs: 30_000,
            });
            expect(rejected.exitCode, `process reference did not block reclaim\n${rejected.diagnostic()}`).not.toBe(0);
            expect(rejected.stderr).toContain("process ownership of retired epoch backing");
          },
        );

        await runAdministrative("irreversible retired epoch reclaim", ["--reclaim-epoch", firstRotatedEpoch]);
        const reclaimReceipt = join(
          activationGeneration,
          "reclaim",
          `${firstRotatedEpoch}.receipt.json`,
        );
        expect(await readFixtureJson(reclaimReceipt)).toMatchObject({
          schema: "niceeval-docker-profile-epoch-reclaim-receipt/v1",
          epoch: firstRotatedEpoch,
          outerImagePath: firstRotatedOuter,
          coldRollbackAvailable: false,
        });
        expect(await fixtureHostFileExists(firstRotatedOuter)).toBe(false);
        expect(await fixtureHostFileExists(
          join(activationGeneration, "epochs", firstRotatedEpoch, "capsule.json"),
        )).toBe(false);
        const rollbackRejected = await sudo.run(
          administrativeArgv("--rollback-to", firstRotatedEpoch),
          { timeoutMs: 30_000 },
        );
        expect(rollbackRejected.exitCode, rollbackRejected.diagnostic()).not.toBe(0);
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
              throw new AggregateError(
                [primaryError, cleanupError],
                `Profile SetupPrefix owner failed: ${String(primaryError)}; cleanup also failed: ${cleanupError.message}`,
              );
            }
            throw cleanupError;
          }
        }
      }
    });
  });
}, 1_200_000);

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
