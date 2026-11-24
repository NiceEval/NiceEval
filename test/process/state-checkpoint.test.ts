// 跨进程保证：进程终止与信号——真实 CLI Run 恢复在 checkpoint 提交前后都能检查精确保存事实。
import { copyFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { execa } from "execa";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { test, expect } from "vitest";
import { createJudgeProject, HOST_SANDBOX_SOURCE, invokeCli } from "../integration/fixtures/judge-harness/harness.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const capabilityModule = new URL("../../packages/niceeval/src/sandbox/backend.ts", import.meta.url).href;
const planPreload = `
  import { registerHooks } from "node:module";
  import { noSandboxBackendCapabilities, registerSandboxCapabilities, supportedBackendCapability } from ${JSON.stringify(capabilityModule)};
  globalThis.bindFixtureState = (sandbox, files) => registerSandboxCapabilities(sandbox, {
    ...noSandboxBackendCapabilities,
    ensureLifetime: supportedBackendCapability(async () => ({ ready: true })),
    state: supportedBackendCapability(files),
  });
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/sandbox/layer.ts")) return loaded;
    const source = Buffer.from(loaded.source).toString();
    const needle = 'reuse: { _tag: "Unsupported", reason: "custom provider has no reset contract" },';
    if (!source.includes(needle)) throw new Error("Local checkpoint provider planning seam is missing.");
    return { ...loaded, source: source.replace(needle,
      'reuse: name === "state-fixture" ? { _tag: "Supported" } : { _tag: "Unsupported", reason: "custom provider has no reset contract" }, ...(name === "state-fixture" ? { state: {} } : {}),') };
  } });
`;
const provider = HOST_SANDBOX_SOURCE
  .replace('name: "judge-sandbox-host"', 'name: "state-fixture"')
  .replace('mkdtemp(join(tmpdir(), "niceeval-judge-sandbox-"))', 'mkdtemp(join(import.meta.dirname, "physical-"))')
  .replace("  return {\n    sandboxId:", "  const sandbox = {\n    sandboxId:")
  .replace("  };\n}\n\nexport default defineSandbox", `  };
  const resolveRoots = async (paths) => ({ roots: await Promise.all(paths.map(async (declared) => {
    const name = declared.slice(2);
    return { declared, resolved: "/home/state-fixture/" + name,
      present: await sandbox.pathExists(join(root, name)) };
  })) });
  const physical = ({ declared }) => join(root, declared.slice(2));
  if (process.env.STATE_TEST_PREEXISTING === "1") await writeFile(join(root, ".memory"), "from template");
  globalThis.bindFixtureState(sandbox, {
      resolve: resolveRoots,
      restore: async ({ roots }, chunks) => {
        const received = [];
        for await (const chunk of chunks) received.push(Buffer.from(chunk));
        if (roots[0].present) await writeFile(physical(roots[0]), Buffer.concat(received));
      },
      capture: async ({ roots }) => {
        const manifest = await resolveRoots(roots.map(({ declared }) => declared));
        async function* chunks() {
          if (manifest.roots[0].present) yield await readFile(physical(roots[0]));
        }
        return { manifest, chunks: chunks() };
      },
      withQuiescence: async (_signal, capture) => {
        if (active.size !== 0) return false;
        await capture();
        return true;
      },
  });
  return sandbox;
}

export default defineSandbox`);

const agent = `
  import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
  import { shell } from "niceeval/sandbox";
  export default defineSandboxAgent({
    name: "memory-agent", evidenceCoverage: completeEvidenceCoverage,
    install: { identity: { agent: "memory-agent", version: "1", revision: "1" }, probe: shell("true") },
    async send(input, ctx) {
      const outcome = await ctx.sandbox.runShell(
        'file="$HOME/.memory"; count=0; if test -f "$file"; then count=$(cat "$file"); fi; next=$((count + 1)); printf "%s" "$next" > "$file"; printf "%s" "$next"',
        { signal: ctx.signal },
      );
      if (outcome.exitCode !== 0) throw new Error(outcome.stderr);
      return { status: "completed", events: [{ type: "message", role: "assistant", text: outcome.stdout }] };
    },
  });
`;
const evalSource = `
  import { defineEval } from "niceeval";
  export default defineEval({ async test(t) {
    const turn = await t.send("write memory");
    turn.succeeded();
  } });
`;

function runCli(cwd: string, args: readonly string[], extra: { readonly env?: Record<string, string> | undefined; readonly fault?: string } = {}) {
  const preload = `data:text/javascript,${encodeURIComponent(planPreload + (extra.fault ?? ""))}`;
  return execa(process.execPath, [...process.execArgv, "--import", preload, cli, ...args], {
    cwd, reject: false, timeout: 35_000, ...(extra.env === undefined ? {} : { env: extra.env }),
  });
}

function stateEvents(stdout: string) {
  return stdout.trim().split("\n").map((line) => JSON.parse(line)).filter((event) => event.type === "state");
}

const experimentSetup = `
  import { defineExperiment } from "niceeval";
  import agent from "../agent.ts";
  import sandbox from "../sandbox.ts";
`;
const baseExperiment = 'adapter: agent, sandbox, evals: ["memory/"],';
const memorySource = `
  import { defineState } from "niceeval";
  import { shell } from "niceeval/sandbox";
  export const memory = defineState({
    name: "memory", version: "1", paths: ["~/.memory"],
    initialize: shell({ id: "state-init", command: 'printf 0 > "$HOME/.memory"' }),
  });
`;

function fixture(prefix: string, experiments: Record<string, string>) {
  return createJudgeProject(prefix, {
    config: "export default {};",
    agent,
    sandbox: provider,
    experiments,
    evals: {},
    extra: {
      "evals/memory/a.eval.ts": evalSource,
      "evals/memory/b.eval.ts": evalSource,
      "evals/memory/eval-group.ts": `
        import { defineEvalGroup } from "niceeval";
        import a from "./a.eval.ts";
        import b from "./b.eval.ts";
        export default defineEvalGroup({ evals: [a, b], onUnavailable: "stop-group" });
      `,
      "memory.ts": memorySource,
    },
  });
}

const directExperiment = `
  ${experimentSetup}
  import { memory } from "../memory.ts";
  export default defineExperiment({ ${baseExperiment} state: [memory.bind({ cohort: process.env.STATE_TEST_COHORT ?? "test" })] });
`;

async function execute(cwd: string, experiment: string, env?: Record<string, string>) {
  const result = await runCli(cwd, ["exp", experiment, "--json"], { env });
  expect(result.exitCode, result.stderr + result.stdout).toBe(0);
  return stateEvents(result.stdout);
}

// @feature docs/feature/state/use-case/accumulate-in-group.md
test("a group accumulates across attempts and resumes from the last committed checkpoint", { timeout: 45_000 }, async () => {
  const cwd = await fixture("state-accumulate-", { "runs.ts": directExperiment });
  try {
    const first = await execute(cwd, "runs");
    expect(first.map(({ event }) => event)).toEqual(["initialized", "saved"]);
    const [runId] = first.filter(({ event }) => event === "saved").map((event) => event.runId);
    const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
    expect(run.sandboxState).toMatchObject({ status: "known", executions: [{ save: { status: "saved" } }] });
    const published = run.slots.flatMap(({ publication }) => publication.state === "published" ? [publication.attemptLocator] : []);
    expect(published).toHaveLength(2);
    const contexts = await Promise.all(published.map(async (locator) => {
      const shown = await invokeCli(cwd, ["show", locator, "--json"]);
      expect(shown.code, shown.stderr).toBe(0);
      return JSON.parse(shown.stdout.trim().split("\n")[0]!).attempt.sandboxState.context;
    }));
    expect(new Set(contexts.map(({ executionId }) => executionId)).size).toBe(1);
    expect(contexts.map(({ earlierAttempts }) => earlierAttempts).sort()).toEqual([0, 1]);
    const portable = join(cwd, "portable.sqlite");
    await copyFile(join(cwd, ".niceeval", "record.sqlite"), portable);
    const offline = await invokeCli(cwd, ["show", published[0]!, "--record", portable, "--json"]);
    expect(offline.code, offline.stderr).toBe(0);
    expect(JSON.parse(offline.stdout.trim().split("\n")[0]!).attempt.sandboxState.context).toEqual(contexts[0]);
    const offlineRun = await invokeCli(cwd, ["show", `run:${runId}`, "--record", portable, "--json"]);
    expect(offlineRun.code, offlineRun.stderr).toBe(0);
    expect(JSON.parse(offlineRun.stdout).run.value.sandboxState).toEqual(run.sandboxState);
    const accepted = await invokeCli(cwd, ["accept", published[0]!, "--dry"]);
    expect(accepted.code).not.toBe(0);
    expect(accepted.stderr).toContain("state-adoption-unsupported");
    expect(first[1].checkpoint.digest).toBe("sha256:d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35");
    const next = await execute(cwd, "runs");
    expect(next.map(({ event }) => event)).toEqual(["restored", "saved"]);
    expect(next[0].checkpoint).toEqual(first[1].checkpoint);
    expect(next[1].checkpoint.checkpointId).not.toBe(first[1].checkpoint.checkpointId);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

// @feature docs/feature/state/library.md#路径边界
test("a provider with fresh-only restore rejects roots created by its template", { timeout: 20_000 }, async () => {
  const cwd = await fixture("state-root-existing-", { "runs.ts": directExperiment });
  try {
    const dry = await runCli(cwd, ["exp", "runs", "--dry", "--json"]);
    expect(dry.exitCode, dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout).groups[0].state[0].origin.kind).toBe("fresh");
    const result = await runCli(cwd, ["exp", "runs", "--json"], { env: { STATE_TEST_PREEXISTING: "1" } });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("state-root-preexisting");
    expect(result.stderr + result.stdout).toContain("/home/state-fixture/.memory");
    expect(stateEvents(result.stdout).map(({ event }) => event)).toEqual(["restore-failed", "save-skipped"]);
    const listed = await Effect.runPromise(runHost.list({ cwd }));
    const { run } = await Effect.runPromise(runHost.get({ cwd, runId: listed.runs[0]!.runId }));
    expect(run.slots.every(({ publication }) => publication.state !== "published")).toBe(true);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

// @feature docs/feature/state/library.md#错误
test("State with cross-Group Sandbox reuse is rejected in planning", { timeout: 20_000 }, async () => {
  const cwd = await fixture("state-reuse-conflict-", {
    "runs.ts": directExperiment.replace(baseExperiment, baseExperiment + " sandboxReuse: true,"),
  });
  try {
    const result = await runCli(cwd, ["exp", "runs", "--dry", "--json"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("state-provider-unsupported");
    expect((await Effect.runPromise(runHost.list({ cwd }))).runs).toEqual([]);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

// @feature docs/feature/state/use-case/start-new-cohort.md
test("a fresh cohort starts empty and the previous cohort keeps its checkpoint", { timeout: 45_000 }, async () => {
  const cwd = await fixture("state-cohort-", { "runs.ts": directExperiment });
  try {
    const first = await execute(cwd, "runs", { STATE_TEST_COHORT: "old" });
    const fresh = await execute(cwd, "runs", { STATE_TEST_COHORT: "fresh" });
    expect(fresh[0].event).toBe("initialized");
    expect(fresh[1].checkpoint.digest).toBe(first[1].checkpoint.digest);
    expect(fresh[1].checkpoint.checkpointId).not.toBe(first[1].checkpoint.checkpointId);
    const resumed = await execute(cwd, "runs", { STATE_TEST_COHORT: "old" });
    expect(resumed[0].checkpoint).toEqual(first[1].checkpoint);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

// @feature docs/feature/state/use-case/state-in-plugin.md
test("a State plugin reuses the condition with separate lineages for each Experiment", { timeout: 45_000 }, async () => {
  const source = `
    ${experimentSetup}
    import { definePlugin } from "niceeval/plugin";
    import { memory } from "../memory.ts";
    const condition = definePlugin({ name: "memory", identity: { cohort: "test" }, state: [memory.bind({ cohort: "test" })] });
    export default defineExperiment({ ${baseExperiment} plugins: [condition] });
  `;
  const cwd = await fixture("state-plugin-", { "one.ts": source, "two.ts": source });
  try {
    const one = await execute(cwd, "one");
    const two = await execute(cwd, "two");
    expect(one[0].event).toBe("initialized");
    expect(two[0].event).toBe("initialized");
    expect([one[1].lineage.experimentId, two[1].lineage.experimentId]).toEqual(["one", "two"]);
    expect(one[1].checkpoint.checkpointId).not.toBe(two[1].checkpoint.checkpointId);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

function killAtCheckpoint(moment: "before" | "after") {
  return `
    import { Worker } from "node:worker_threads";
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(request, ...extra) {
      if (request?.operation === "registry" && request.command?._tag === "sandbox-state" && request.command.state._tag === "state-commit") {
        if (${JSON.stringify(moment)} === "before") process.kill(process.pid, "SIGKILL");
        else this.prependListener("message", (response) => {
          if (response.id === request.id && response.state === "success") process.kill(process.pid, "SIGKILL");
        });
      }
      return send.call(this, request, ...extra);
    };
  `;
}

// @feature docs/feature/state/README.md#shared-state-recovery
test.each(["before", "after"] as const)("exact CLI recovery around the checkpoint commit (%s)", { timeout: 45_000 }, async (moment) => {
  const cwd = await fixture("state-recovery-", { "runs.ts": directExperiment });
  try {
    const stopped = await runCli(cwd, ["exp", "runs", "--json"], { fault: killAtCheckpoint(moment) });
    expect(stopped.signal, stopped.stderr + stopped.stdout).toBe("SIGKILL");
    const listed = await Effect.runPromise(runHost.list({ cwd }));
    const { runId } = listed.runs[0]!;
    const prior = await Effect.runPromise(runHost.get({ cwd, runId }));
    expect(prior.run.sandboxState).toMatchObject({ status: "known", executions: [{ save: { status: moment === "before" ? "pending" : "saved" } }] });
    const canonical = JSON.stringify({ cohort: "test", evalGroupId: "memory", experimentId: "runs", name: "memory", version: "1" });
    const { createHash } = await import("node:crypto");
    const recoveryKey = "state/" + createHash("sha256").update(canonical).digest("hex");
    const evidence = await Effect.runPromise(experimentHost.after.inspect({ cwd, currentHost: hostname(), recoveryKey, experimentSelector: "runs" }));
    if (evidence.status !== "ready" || evidence.evidence === undefined) throw new Error(JSON.stringify(evidence));
    const recovered = await invokeCli(cwd, ["exp", "runs", "--after", "--recover-shared-state", recoveryKey,
      "--owner-token", evidence.evidence.ownerToken, "--confirm-owner-terminated", "--confirm-remote-quiesced"]);
    expect(recovered.code, recovered.stderr + recovered.stdout).toBe(0);
    const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
    expect(run.state).toBe("interrupted");
    expect(run.sandboxState).toMatchObject({ status: "known", executions: [{ save: {
      status: moment === "before" ? "skipped" : "saved",
      ...(moment === "before" ? { reason: "recovered" } : {}),
    } }] });
    expect((await execute(cwd, "runs"))[0].event).toBe(moment === "before" ? "initialized" : "restored");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
