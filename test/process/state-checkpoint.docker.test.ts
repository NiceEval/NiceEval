// 跨进程保证：外部程序与 Provider——真实 Docker Engine 恢复文件树并拒绝不允许的归档成员。
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { decodeExpPlanDocument, experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { expect, test } from "vitest";
import { createJudgeProject, invokeCli } from "../integration/fixtures/judge-harness/harness.ts";

// Eval Group reuse uses Git to track and reset the workspace between Attempts.
const image = "node@sha256:bde0dae02f2b12d2bce5ee72b2432f0e511767b7b2dc4dd3b064df11ae422fee";
const memory = `
  import { defineState } from "niceeval";
  import { shell } from "niceeval/sandbox";
  export const memory = defineState({
    name: "memory", version: "1", paths: ["~/.niceeval-state-test"],
    initialize: shell({ id: "init-memory", command: 'mkdir "$HOME/.niceeval-state-test"; echo 0 > "$HOME/.niceeval-state-test/count"' }),
  });
  export const good = defineState({
    name: "good", version: "1", paths: ["~/.niceeval-state-good"],
    initialize: shell({ id: "init-good", command: 'echo untouched > "$HOME/.niceeval-state-good"' }),
  });
`;
const condition = `
  import { definePlugin } from "niceeval/plugin";
  import { memory } from "../memory.ts";
  const condition = definePlugin({ name: "remember", identity: { cohort: "one" }, requires: { evalGroup: true },
    state: [memory.bind({ cohort: "one" })] });
`;
const evalSource = `
  import { defineEval } from "niceeval";
  export default defineEval({ async test(t) { (await t.send("remember")).succeeded(); } });
`;
const fixture = async (source: string, writes: string, experiments = ["trial"]) =>
  createJudgeProject("niceeval-docker-state-", {
    config: "export default {};",
    agent: `
      import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
      import { shell } from "niceeval/sandbox";
      export default defineSandboxAgent({
        name: "test-memory", evidenceCoverage: completeEvidenceCoverage,
        install: { identity: { agent: "test-memory", version: "1", revision: "1" }, probe: shell("true") },
        async send(_input, ctx) {
          const result = await ctx.sandbox.runShell(${JSON.stringify(writes)}, { signal: ctx.signal });
          if (result.exitCode !== 0) throw new Error(result.stderr);
          return { status: "completed", events: [{ type: "message", role: "assistant", text: result.stdout }] };
        },
      });
    `,
    sandbox: `
      import { dockerSandbox } from "niceeval/sandbox";
      export default dockerSandbox({ source: { type: "image", image: ${JSON.stringify(image)} }, user: "node",
        lifetimeMs: 5 * 60_000 });
    `,
    experiments: Object.fromEntries(experiments.map((name) => [name + ".ts", `
      import { defineExperiment } from "niceeval";
      import sandbox from "../sandbox.ts";
      import adapter from "../agent.ts";
      ${source}
    `])),
    evals: {},
    extra: {
      "memory.ts": memory,
      "evals/memory/a.eval.ts": evalSource,
      "evals/memory/b.eval.ts": evalSource,
      "evals/memory/eval-group.ts": `
        import { defineEvalGroup } from "niceeval";
        import a from "./a.eval.ts";
        import b from "./b.eval.ts";
        export default defineEvalGroup({ evals: [a, b], onUnavailable: "stop-group" });
      `,
    },
  });

const increment = 'set -eu; file="$HOME/.niceeval-state-test/count"; n=$(cat "$file"); echo "$((n+1))" > "$file"';

function bind(cohort: string) {
  return `
    import { memory } from "../memory.ts";
    import { definePlugin } from "niceeval/plugin";
    import { shell } from "niceeval/sandbox";
    const before = definePlugin({
      name: "check-memory", identity: { revision: 1 },
      sandbox: { before: shell({ id: "check-memory", command: 'test -f "$HOME/.niceeval-state-test/count"' }) },
    });
    export default defineExperiment({ evals: ["memory/"], adapter, sandbox, plugins: [before],
      state: [memory.bind({ cohort: ${JSON.stringify(cohort)} })] });
  `;
}

async function getSaved(cwd: string, experimentSelector: string) {
  const plan = await Effect.runPromise(experimentHost.invocation.plan({ cwd, experimentSelector, config: {} }));
  if (plan.status !== "ready") throw new Error(JSON.stringify(plan));
  const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: plan.plan }));
  const { run } = await Effect.runPromise(runHost.get({ cwd, runId: receipt.createdRunIds[0]! }));
  expect(run.state).toBe("completed");
  if (run.sandboxState.status !== "known") throw new Error("State execution facts were unavailable.");
  expect(run.sandboxState.executions).toHaveLength(1);
  const [execution] = run.sandboxState.executions;
  if (execution?.save.status !== "saved") throw new Error(JSON.stringify(execution));
  return { origin: execution.bindings[0]!.origin, checkpoint: execution.save.checkpoints[0]!, run };
}

// @feature docs/feature/state/use-case/accumulate-in-group.md
test("restores a real Docker file tree and accumulates across Attempts", { timeout: 40_000 }, async () => {
  const cwd = await fixture(bind("one"), increment);
  try {
    const first = await getSaved(cwd, "trial");
    const next = await getSaved(cwd, "trial");
    expect(first.origin.kind).toBe("fresh");
    expect(first.run.slots.filter(({ publication }) => publication.state === "published")).toHaveLength(2);
    expect(next.origin).toEqual({ kind: "checkpoint", checkpoint: first.checkpoint });
    expect(next.checkpoint.digest).not.toBe(first.checkpoint.digest);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/state/architecture.md#恢复与保存
test("records only State and Run facts when the Docker State root already exists", { timeout: 35_000 }, async () => {
  const cwd = await fixture(bind("one"), increment);
  try {
    const group = join(cwd, "evals/memory/eval-group.ts");
    const groupSource = await readFile(group, "utf8");
    await Promise.all([
      writeFile(join(cwd, "memory.ts"), memory.replace('"~/.niceeval-state-test"', '"~/.profile"')),
      writeFile(group, groupSource.replace('"stop-group"', '"replace-sandbox"')),
    ]);
    const plan = await Effect.runPromise(experimentHost.invocation.plan({ cwd, experimentSelector: "trial", config: {} }));
    if (plan.status !== "ready") throw new Error(JSON.stringify(plan));
    await expect(Effect.runPromise(experimentHost.invocation.run({ plan: plan.plan }))).rejects.toMatchObject({
      code: "state-root-preexisting",
    });
    const { runs } = await Effect.runPromise(runHost.list({ cwd }));
    expect(runs).toHaveLength(1);
    const { run } = await Effect.runPromise(runHost.get({ cwd, runId: runs[0]!.runId }));
    expect(run.slots.map(({ publication }) => publication)).toEqual([
      { state: "absent", reason: "dispatch-failed" },
      { state: "absent", reason: "dispatch-failed" },
    ]);
    expect(run.sandboxState).toMatchObject({
      status: "known",
      executions: [
        { restore: { status: "failed", reason: "restore-failed" }, save: { status: "skipped", reason: "restore-failed" } },
      ],
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/eval-groups/architecture/lifecycle.md#不可用策略
test("publishes an errored Attempt when Docker lifetime confirmation fails after State is ready", { timeout: 35_000 }, async () => {
  const cwd = await fixture(bind("one"), increment);
  try {
    const sandbox = join(cwd, "sandbox.ts");
    const source = await readFile(sandbox, "utf8");
    await writeFile(sandbox, source.replace("lifetimeMs: 5 * 60_000", ""));
    const result = await invokeCli(cwd, ["exp", "trial", "--json"]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("the docker sandbox needs lifetimeMs");
    const { runs } = await Effect.runPromise(runHost.list({ cwd }));
    const { run } = await Effect.runPromise(runHost.get({ cwd, runId: runs[0]!.runId }));
    const started = run.slots.find(({ evalId }) => evalId === "memory/a")?.publication;
    if (started?.state !== "published") throw new Error(`Expected an errored Attempt: ${JSON.stringify(run.slots)}`);
    expect(run.slots.find(({ evalId }) => evalId === "memory/b")?.publication).toEqual({
      state: "absent",
      reason: "stopped-by-failure",
    });
    const execution = run.sandboxState.status === "known" ? run.sandboxState.executions[0] : undefined;
    expect(execution).toMatchObject({
      restore: { status: "ready" },
      save: { status: "skipped", reason: "prepare-failed" },
    });
    const shown = await invokeCli(cwd, ["show", started.attemptLocator, "--json"]);
    expect(shown.code, shown.stderr).toBe(0);
    expect(JSON.parse(shown.stdout.trim().split("\n")[0]!).attempt).toMatchObject({
      verdict: "errored",
      sandboxState: { status: "known", context: { executionId: execution?.executionId, earlierAttempts: 0 } },
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/state/use-case/start-new-cohort.md
test("a second cohort starts with fresh contents on the same Experiment", { timeout: 50_000 }, async () => {
  const cwd = await fixture(bind("one"), increment);
  const changeCohort = (name: string) => writeFile(join(cwd, "experiments/trial.ts"), `
    import { defineExperiment } from "niceeval";
    import sandbox from "../sandbox.ts";
    import adapter from "../agent.ts";
    ${bind(name)}
  `);
  try {
    const original = await getSaved(cwd, "trial");
    await changeCohort("two");
    const fresh = await getSaved(cwd, "trial");
    expect(fresh.origin.kind).toBe("fresh");
    expect(fresh.checkpoint.digest).toBe(original.checkpoint.digest);
    await changeCohort("one");
    expect((await getSaved(cwd, "trial")).origin).toEqual({ kind: "checkpoint", checkpoint: original.checkpoint });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/state/use-case/state-in-plugin.md
test("a State plugin shares the condition while keeping independent Experiment checkpoints", { timeout: 40_000 }, async () => {
  const cwd = await fixture(`
    ${condition}
    export default defineExperiment({ evals: ["memory/"], adapter, sandbox, plugins: [condition] });
  `, increment, ["primary", "alternative"]);
  try {
    const first = await getSaved(cwd, "primary");
    const second = await getSaved(cwd, "alternative");
    expect(second.origin.kind).toBe("fresh");
    expect(second.checkpoint.digest).toBe(first.checkpoint.digest);
    expect(second.checkpoint.checkpointId).not.toBe(first.checkpoint.checkpointId);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const invalidMembers = [
  ["Unix socket", `
    socket="$HOME/.niceeval-state-test/socket"
    if ! test -S "$socket"; then
      node -e "const net = require('node:net'); net.createServer().listen(process.argv[1], () => process.exit(0))" "$socket"
    fi
    test -S "$socket"
  `],
  ["unreadable file", 'touch "$HOME/.niceeval-state-test/secret"; chmod 000 "$HOME/.niceeval-state-test/secret"'],
] as const;

// @feature docs/feature/state/architecture.md#恢复与保存
test.each(invalidMembers)("a %s in the Docker change list prevents every binding from committing", { timeout: 35_000 }, async (_name, invalidate) => {
  const cwd = await fixture(`
    import { memory, good } from "../memory.ts";
    export default defineExperiment({ evals: ["memory/"], adapter, sandbox,
      state: [good.bind({ cohort: "one" }), memory.bind({ cohort: "one" })] });
  `, increment + "\n" + invalidate);
  try {
    const result = await invokeCli(cwd, ["exp", "trial", "--json"]);
    expect(result.code).not.toBe(0);
    expect(result.stdout.trim(), result.stderr).not.toBe("");
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line)).filter(({ type }) => type === "state");
    expect(events.map(({ event, reason }) => [event, reason]), result.stderr + result.stdout).toEqual([
      ["initialized", undefined], ["initialized", undefined],
      ["save-failed", "capture-failed"], ["save-failed", "capture-failed"],
    ]);
    const planned = await invokeCli(cwd, ["exp", "trial", "--dry", "--json"]);
    expect(planned.code, planned.stderr).toBe(0);
    expect(decodeExpPlanDocument(JSON.parse(planned.stdout)).groups[0]?.state.map(({ origin }) => origin.kind)).toEqual([
      "fresh", "fresh",
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
