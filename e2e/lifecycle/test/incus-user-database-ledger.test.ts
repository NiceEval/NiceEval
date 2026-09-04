import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { command, pollUntil, withProjectCopy, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface JournalRecord {
  readonly event: string;
  readonly detail: {
    readonly label?: string;
    readonly method?: string;
    readonly path?: string;
    readonly project?: string;
    readonly body?: {
      readonly name?: string;
      readonly source?: { readonly type?: string; readonly project?: string };
    };
  };
}

const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const runtimeProject = "niceeval-eval-dev";
const artifactProject = "niceeval-artifacts-dev";
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-incus-userdb-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

async function journal(path: string): Promise<readonly JournalRecord[]> {
  try {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as JournalRecord);
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return [];
    throw cause;
  }
}

async function waitForBlocked(path: string, after: number): Promise<readonly JournalRecord[]> {
  return pollUntil(async () => {
    const records = await journal(path);
    return records.slice(after).some((record) => record.event === "blocked") ? records : undefined;
  }, { timeoutMs: 30_000, intervalMs: 50, label: "fake Incus blocking checkpoint" });
}

async function waitForChildClose(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit) => child.once("close", () => resolveExit()));
}

async function killAtProviderBoundary(
  cwd: string,
  env: NodeJS.ProcessEnv,
  journalPath: string,
): Promise<readonly JournalRecord[]> {
  const before = (await journal(journalPath)).length;
  const child = spawn("pnpm", ["--silent", "exec", "niceeval", "exp", "incus-ledger", "probe", "--rerun=all"], {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
  try {
    const records = await waitForBlocked(journalPath, before);
    if (child.pid === undefined) throw new Error("niceeval crash fixture has no process-group id");
    process.kill(-child.pid, "SIGKILL");
    await waitForChildClose(child);
    return records;
  } catch (cause) {
    if (child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* process already stopped */ }
    }
    await waitForChildClose(child);
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${Buffer.concat(output).toString("utf8")}`);
  }
}

function artifactPublishes(records: readonly JournalRecord[]): readonly JournalRecord[] {
  return records.filter((record) => record.event === "query" && record.detail.method === "POST" &&
    record.detail.path === "/1.0/instances" && record.detail.project === artifactProject);
}

function artifactConsumers(records: readonly JournalRecord[]): readonly JournalRecord[] {
  return records.filter((record) => record.event === "query" && record.detail.method === "POST" &&
    record.detail.path === "/1.0/instances" && record.detail.project === runtimeProject &&
    record.detail.body?.source?.type === "copy" && record.detail.body.source.project === artifactProject);
}

function artifactDeletes(records: readonly JournalRecord[]): readonly JournalRecord[] {
  return records.filter((record) => record.event === "query" && record.detail.method === "DELETE" &&
    record.detail.project === artifactProject);
}

test("Incus repository fences admission, recovers crashes, and reuses only committed artifacts [necase_E2ARE3AS30W6PA6H]", async () => {
  await withProjectCopy(projectCopy, async ({ root: projectRoot }) => {
    await withTempDir("niceeval-e2e-incus-userdb-runtime-", async (runtimeRoot) => {
      const binDir = join(runtimeRoot, "bin");
      const descriptor = join(runtimeRoot, "incus-provider.json");
      const state = join(runtimeRoot, "incus-state.json");
      const journalPath = join(runtimeRoot, "incus-journal.ndjson");
      const fakeIncus = resolve("fixtures/fake-incus.mjs");
      await mkdir(binDir, { recursive: true });
      const wrapper = join(binDir, "incus");
      await writeFile(wrapper, `#!/usr/bin/env node\nawait import(${JSON.stringify(pathToFileURL(fakeIncus).href)});\n`, "utf8");
      await chmod(wrapper, 0o755);
      await writeFile(descriptor, `${JSON.stringify({
        schemaVersion: "niceeval.incus-provider/v2",
        domains: [{
          name: "development",
          status: "configured",
          executionDomainId: "e2e-incus-development",
          project: runtimeProject,
          storagePool: "niceeval-sandbox-dev",
          network: "niceeval-dev",
          storage: "development-dir",
          quota: "unattested",
          maxInstances: 4,
          artifactProject,
          artifactMaxInstances: 1,
          dockerDataBytes: 1024 ** 3,
          workdir: "/home/sandbox/workspace",
          user: "node",
          hostGateway: "10.0.0.1",
          trustedBaseImages: [`niceeval/docker-execution-v1@sha256:${digest}`],
        }],
      })}\n`, "utf8");
      await writeFile(join(projectRoot, "experiments/incus-ledger.ts"), `
import { defineExperiment } from "niceeval";
import { incusSandbox, shell } from "niceeval/sandbox";
import { quickAgent } from "../agents/deterministic.ts";

const sandbox = incusSandbox({
  image: "niceeval/docker-execution-v1@sha256:${digest}",
  project: "${runtimeProject}",
  storagePool: "niceeval-sandbox-dev",
  acceptDevelopmentDomain: true,
  resources: { dockerDataBytes: ${1024 ** 3} },
}).before(shell({ id: "incus-ledger-prefix", command: "true", changeFrequency: 10 }));

export default defineExperiment({
  agent: quickAgent,
  sandbox,
  evals: ["probe"],
  attempts: 1,
  maxConcurrency: 1,
});
`, "utf8");

      const baseEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        NICEEVAL_HOME: join(runtimeRoot, "user"),
        XDG_STATE_HOME: join(runtimeRoot, "xdg-state"),
        NICEEVAL_INCUS_DESCRIPTOR: descriptor,
        NICEEVAL_E2E_FAKE_INCUS_STATE: state,
        NICEEVAL_E2E_FAKE_INCUS_JOURNAL: journalPath,
      };
      const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

      const cold = await niceeval.run(["exp", "incus-ledger", "probe", "--rerun=all"], { cwd: projectRoot, env: baseEnv });
      expect(cold.exitCode, "the fixture deliberately fails agent.ensure after provider setup").not.toBe(0);
      const afterCold = await journal(journalPath);
      expect(artifactPublishes(afterCold), `${cold.diagnostic()}\nprovider journal:\n${JSON.stringify(afterCold, null, 2)}`).toHaveLength(1);
      expect(artifactConsumers(afterCold)).toHaveLength(1);

      const warmStart = afterCold.length;
      const warm = await niceeval.run(["exp", "incus-ledger", "probe", "--rerun=all"], { cwd: projectRoot, env: baseEnv });
      expect(warm.exitCode, "the fixture deliberately fails agent.ensure after committed artifact lookup").not.toBe(0);
      const afterWarm = await journal(journalPath);
      const warmRecords = afterWarm.slice(warmStart);
      expect(artifactPublishes(warmRecords)).toHaveLength(0);
      expect(artifactConsumers(warmRecords)).toHaveLength(1);

      const fenceClaim = `${state}.block-claimed`;
      await rm(fenceClaim, { force: true });
      const fenceCrash = await killAtProviderBoundary(projectRoot, {
        ...baseEnv,
        NICEEVAL_E2E_FAKE_INCUS_BLOCK_ONCE: `GET /1.0/instances?project=${runtimeProject}`,
      }, journalPath);
      expect(fenceCrash.some((record) => record.event === "blocked" && record.detail.label?.startsWith("GET /1.0/instances"))).toBe(true);
      const afterFence = (await journal(journalPath)).length;
      const fenceRecovery = await niceeval.run(["exp", "incus-ledger", "probe", "--rerun=all"], { cwd: projectRoot, env: baseEnv });
      expect(fenceRecovery.exitCode).not.toBe(0);
      expect(artifactConsumers((await journal(journalPath)).slice(afterFence))).toHaveLength(1);

      await rm(fenceClaim, { force: true });
      const allocationCrashRecords = await killAtProviderBoundary(projectRoot, {
        ...baseEnv,
        NICEEVAL_E2E_FAKE_INCUS_BLOCK_ONCE: `POST /1.0/instances?project=${runtimeProject}`,
      }, journalPath);
      const crashedCreate = [...allocationCrashRecords].reverse().find((record) => record.event === "query" &&
        record.detail.method === "POST" && record.detail.path === "/1.0/instances" && record.detail.project === runtimeProject);
      const crashedName = crashedCreate?.detail.body?.name;
      expect(crashedName).toBeTruthy();
      const recoveryStart = (await journal(journalPath)).length;
      const allocationRecovery = await niceeval.run(["exp", "incus-ledger", "probe", "--rerun=all"], { cwd: projectRoot, env: baseEnv });
      expect(allocationRecovery.exitCode).not.toBe(0);
      const recoveryRecords = (await journal(journalPath)).slice(recoveryStart);
      expect(recoveryRecords.some((record) => record.event === "query" && record.detail.method === "DELETE" &&
        record.detail.path === `/1.0/instances/${crashedName}` && record.detail.project === runtimeProject)).toBe(true);
      expect(artifactConsumers(recoveryRecords)).toHaveLength(1);

      const providerState = JSON.parse(await readFile(state, "utf8")) as {
        instances: Record<string, Record<string, unknown>>;
        volumes: Record<string, Record<string, unknown>>;
      };
      const orphanArtifact = "nea-orphan-without-intent";
      providerState.instances[artifactProject] ??= {};
      providerState.instances[artifactProject]![orphanArtifact] = {
        name: orphanArtifact,
        status: "Stopped",
        type: "virtual-machine",
        config: {
          "user.niceeval.artifactState": "committed",
          "user.niceeval.allocationId": "orphan-artifact-id",
        },
        expanded_devices: {},
      };
      await writeFile(state, `${JSON.stringify(providerState)}\n`, "utf8");

      const doctor = await niceeval.run(["sandbox", "provider", "doctor", "incus", "--development"], { cwd: projectRoot, env: baseEnv });
      expect(doctor.exitCode, doctor.diagnostic()).toBe(1);
      expect(doctor.stdout).toContain("status: FAIL (fail closed)");
      expect(doctor.stdout).toContain("4 free of 4");
      expect(doctor.stdout).toContain("artifact-inventory: FAIL [sandbox-artifact-unverified]");
      expect(doctor.stdout).toContain(`project=${artifactProject} instance=${orphanArtifact}`);
      expect(doctor.stdout).toContain("artifact-capacity: FAIL");

      delete providerState.instances[artifactProject]![orphanArtifact];
      await writeFile(state, `${JSON.stringify(providerState)}\n`, "utf8");

      await writeFile(join(projectRoot, "experiments/incus-ledger.ts"), `
import { defineExperiment } from "niceeval";
import { incusSandbox, shell } from "niceeval/sandbox";
import { quickAgent } from "../agents/deterministic.ts";
const sandbox = incusSandbox({ image: "niceeval/docker-execution-v1@sha256:${digest}", project: "${runtimeProject}", storagePool: "niceeval-sandbox-dev", acceptDevelopmentDomain: true, resources: { dockerDataBytes: ${1024 ** 3} } })
  .before(shell({ id: "incus-ledger-prefix-v2", command: "true", changeFrequency: 10 }));
export default defineExperiment({ agent: quickAgent, sandbox, evals: ["probe"], attempts: 1, maxConcurrency: 1 });
`, "utf8");
      const evictionStart = (await journal(journalPath)).length;
      const eviction = await niceeval.run(["exp", "incus-ledger", "probe", "--rerun=all"], { cwd: projectRoot, env: baseEnv });
      expect(eviction.exitCode).not.toBe(0);
      expect(`${eviction.stdout}\n${eviction.stderr}`).toContain("still-current replacement lineage");
      const evictionRecords = (await journal(journalPath)).slice(evictionStart);
      expect(artifactDeletes(evictionRecords)).toHaveLength(0);
      expect(artifactPublishes(evictionRecords)).toHaveLength(0);
      expect(artifactConsumers(evictionRecords)).toHaveLength(0);

      await writeFile(join(projectRoot, "experiments/incus-ledger.ts"), `
import { defineExperiment } from "niceeval";
import { incusSandbox, shell } from "niceeval/sandbox";
import { quickAgent } from "../agents/deterministic.ts";
const sandbox = incusSandbox({ image: "niceeval/docker-execution-v1@sha256:${digest}", project: "${runtimeProject}", storagePool: "niceeval-sandbox-dev", acceptDevelopmentDomain: true, resources: { dockerDataBytes: ${1024 ** 3} } })
  .before(shell({ id: "incus-ledger-prefix", command: "true", changeFrequency: 10 }));
export default defineExperiment({ agent: quickAgent, sandbox, evals: ["probe"], attempts: 1, maxConcurrency: 1 });
`, "utf8");
      await writeFile(`${state}.fail-next`, `POST /1.0/instances?project=${runtimeProject}\n`, "utf8");
      const failedMutation = await niceeval.run(["exp", "incus-ledger", "probe", "--rerun=all"], {
        cwd: projectRoot,
        env: baseEnv,
      });
      expect(failedMutation.exitCode).not.toBe(0);
      expect(`${failedMutation.stdout}\n${failedMutation.stderr}`).toContain(
        "Incus POST /1.0/instances?project=niceeval-eval-dev failed (exit 1): Error: Failed creating instance: storage pool capacity exhausted",
      );
      expect(`${failedMutation.stdout}\n${failedMutation.stderr}`).not.toContain("unexpected JSON shape");
    });
  });
});
