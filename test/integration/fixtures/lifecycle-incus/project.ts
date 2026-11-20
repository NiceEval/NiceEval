import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execa, type ResultPromise } from "execa";

const cli = fileURLToPath(new URL("../../../../packages/niceeval/bin/niceeval.js", import.meta.url));
const fakeIncus = fileURLToPath(new URL("./fake-incus.mjs", import.meta.url));

export const DIGEST = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export const RUNTIME_PROJECT = "niceeval-eval-dev";
export const ARTIFACT_PROJECT = "niceeval-artifacts-dev";

export interface JournalRecord {
  readonly event: string;
  readonly detail: {
    readonly label?: string;
    readonly method?: string;
    readonly path?: string;
    readonly project?: string;
    readonly body?: { readonly name?: string; readonly source?: { readonly type?: string; readonly project?: string } };
  };
}

export interface IncusProject {
  readonly cwd: string;
  readonly runtime: string;
  readonly state: string;
  readonly descriptor: string;
  readonly journalPath: string;
  readonly env: NodeJS.ProcessEnv;
  /** Rewrites the Experiment so its before action id (and optional cache mode) changes. */
  writeExperiment(options: { readonly actionId: string; readonly bypassCache?: boolean }): Promise<void>;
  journal(): Promise<readonly JournalRecord[]>;
  /** Runs the real CLI to completion in the project. */
  niceeval(args: readonly string[], env?: NodeJS.ProcessEnv): Promise<{ exitCode: number | undefined; stdout: string; stderr: string }>;
  /** Starts the real CLI in its own process group; the caller owns the child. */
  start(args: readonly string[], env?: NodeJS.ProcessEnv): ResultPromise;
  dispose(): Promise<void>;
}

export async function readJournal(path: string): Promise<readonly JournalRecord[]> {
  try {
    return (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JournalRecord);
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return [];
    throw cause;
  }
}

export function artifactPublishes(records: readonly JournalRecord[]): readonly JournalRecord[] {
  return records.filter(
    (record) =>
      record.event === "query" &&
      record.detail.method === "POST" &&
      record.detail.path === "/1.0/instances" &&
      record.detail.project === ARTIFACT_PROJECT,
  );
}

export function artifactConsumers(records: readonly JournalRecord[]): readonly JournalRecord[] {
  return records.filter(
    (record) =>
      record.event === "query" &&
      record.detail.method === "POST" &&
      record.detail.path === "/1.0/instances" &&
      record.detail.project === RUNTIME_PROJECT &&
      record.detail.body?.source?.type === "copy" &&
      record.detail.body.source.project === ARTIFACT_PROJECT,
  );
}

export function artifactDeletes(records: readonly JournalRecord[]): readonly JournalRecord[] {
  return records.filter(
    (record) =>
      record.event === "query" && record.detail.method === "DELETE" && record.detail.project === ARTIFACT_PROJECT,
  );
}

/**
 * A temporary project that drives the real Incus provider through a deterministic fake `incus` executable.
 * The fake never starts a VM: it keeps provider state in a JSON file and appends every request to a journal.
 */
export async function createIncusProject(options: {
  readonly artifactMaxInstances?: number;
  readonly artifactStorageReserveBytes?: number;
  readonly artifactEstimatedBytes?: number;
  readonly state?: object;
}): Promise<IncusProject> {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-lifecycle-incus-project-"));
  const runtime = await mkdtemp(join(await realpath(tmpdir()), "niceeval-lifecycle-incus-runtime-"));
  const bin = join(runtime, "bin");
  const descriptor = join(runtime, "incus-provider.json");
  const state = join(runtime, "incus-state.json");
  const journalPath = join(runtime, "incus-journal.ndjson");
  try {
    await Promise.all([join(cwd, "evals"), join(cwd, "experiments"), bin].map((dir) => mkdir(dir, { recursive: true })));
    await writeFile(
      join(bin, "incus"),
      `#!/usr/bin/env node\nawait import(${JSON.stringify(pathToFileURL(fakeIncus).href)});\n`,
    );
    await chmod(join(bin, "incus"), 0o755);
    await writeFile(
      descriptor,
      `${JSON.stringify({
        schemaVersion: "niceeval.incus-provider/v2",
        domains: [
          {
            name: "development",
            status: "configured",
            executionDomainId: "lifecycle-incus-development",
            project: RUNTIME_PROJECT,
            storagePool: "niceeval-sandbox-dev",
            network: "niceeval-dev",
            storage: "development-dir",
            quota: "unattested",
            maxInstances: 4,
            artifactProject: ARTIFACT_PROJECT,
            artifactMaxInstances: options.artifactMaxInstances ?? 4,
            ...(options.artifactStorageReserveBytes === undefined
              ? {}
              : { artifactStorageReserveBytes: options.artifactStorageReserveBytes }),
            ...(options.artifactEstimatedBytes === undefined
              ? {}
              : { artifactEstimatedBytes: options.artifactEstimatedBytes }),
            dockerDataBytes: 1024 ** 3,
            workdir: "/home/sandbox/workspace",
            user: "node",
            hostGateway: "10.0.0.1",
            trustedBaseImages: [`niceeval/docker-execution-v1@sha256:${DIGEST}`],
          },
        ],
      })}\n`,
    );
    if (options.state !== undefined) await writeFile(state, JSON.stringify(options.state));
    await Promise.all([
      writeFile(
        join(cwd, "niceeval.config.ts"),
        'import { defineConfig } from "niceeval";\nexport default defineConfig({ timeoutMs: 120_000, maxConcurrency: 1 });\n',
      ),
      writeFile(
        join(cwd, "agent.ts"),
        `
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

// The fake Incus fails this probe, so every Attempt ends in a deterministic agent.install failure
// after the provider has prepared (or refused to prepare) its Sandbox.
export default defineSandboxAgent({
  name: "lifecycle-incus-agent",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "lifecycle-incus-agent", version: "24.19.0", revision: "1" },
    probe: shell('test "$(node --version)" = "v24.19.0"'),
  },
  send: async () => ({ status: "completed", events: [] }),
});
`,
      ),
      writeFile(
        join(cwd, "evals", "probe.eval.ts"),
        'import { defineEval } from "niceeval";\nexport default defineEval({ async test(t) { await t.send("probe"); } });\n',
      ),
    ]);
  } catch (error) {
    await Promise.all([cwd, runtime].map((path) => rm(path, { recursive: true, force: true })));
    throw error;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    NO_COLOR: "1",
    NICEEVAL_HOME: join(runtime, "user"),
    XDG_STATE_HOME: join(runtime, "xdg-state"),
    NICEEVAL_INCUS_DESCRIPTOR: descriptor,
    NICEEVAL_E2E_FAKE_INCUS_STATE: state,
    NICEEVAL_E2E_FAKE_INCUS_JOURNAL: journalPath,
  };
  const command = (args: readonly string[], extra: NodeJS.ProcessEnv = {}) =>
    [process.execPath, [...process.execArgv, cli, ...args], { cwd, env: { ...env, ...extra }, extendEnv: false }] as const;

  return {
    cwd,
    runtime,
    state,
    descriptor,
    journalPath,
    env,
    async writeExperiment({ actionId, bypassCache = false }) {
      await writeFile(
        join(cwd, "experiments", "incus.ts"),
        `
import { defineExperiment } from "niceeval";
import { incusSandbox, shell } from "niceeval/sandbox";
import agent from "../agent.ts";

const sandbox = incusSandbox({
  image: "niceeval/docker-execution-v1@sha256:${DIGEST}",
  project: "${RUNTIME_PROJECT}",
  storagePool: "niceeval-sandbox-dev",
  acceptDevelopmentDomain: true,
  resources: { dockerDataBytes: ${1024 ** 3} },
}).before(shell({ id: ${JSON.stringify(actionId)}, command: "true", changeFrequency: 10 }));

export default defineExperiment({
  adapter: agent,
  sandbox,${bypassCache ? '\n  sandboxCache: { before: "bypass" },' : ""}
  evals: ["probe"],
  attempts: 1,
  maxConcurrency: 1,
});
`,
      );
    },
    journal: () => readJournal(journalPath),
    async niceeval(args, extra) {
      const [file, argv, opts] = command(args, extra);
      const result = await execa(file, [...argv], { ...opts, reject: false });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    },
    start(args, extra) {
      const [file, argv, opts] = command(args, extra);
      return execa(file, [...argv], { ...opts, reject: false, detached: true }) as ResultPromise;
    },
    async dispose() {
      await Promise.all([cwd, runtime].map((path) => rm(path, { recursive: true, force: true })));
    },
  };
}
