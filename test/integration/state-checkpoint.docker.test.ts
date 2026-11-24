import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { expect, test } from "vitest";
import { createJudgeProject, invokeCli } from "./fixtures/judge-harness/harness.ts";

const image = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
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
      export default dockerSandbox({ source: { type: "image", image: ${JSON.stringify(image)} }, user: "node" });
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
  ["Unix socket", 'node -e "const net = require(\x27node:net\x27); net.createServer().listen(process.argv[1], () => process.exit(0))" "$HOME/.niceeval-state-test/socket"; test -S "$HOME/.niceeval-state-test/socket"'],
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
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line)).filter(({ type }) => type === "state");
    expect(events.map(({ event, reason }) => [event, reason])).toEqual([
      ["initialized", undefined], ["initialized", undefined],
      ["save-failed", "capture-failed"], ["save-failed", "capture-failed"],
    ]);
    const planned = await invokeCli(cwd, ["exp", "trial", "--dry", "--json"]);
    expect(planned.code, planned.stderr).toBe(0);
    expect(JSON.parse(planned.stdout).groups[0].state.map(({ origin }: { origin: { kind: string } }) => origin.kind))
      .toEqual(["fresh", "fresh"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
