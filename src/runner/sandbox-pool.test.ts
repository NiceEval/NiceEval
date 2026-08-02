// cases: docs/engineering/testing/unit/sandbox.md
// pair-owned plan 的 reuse 门：池只消费物理计划的 runtime capability，不能从作者声明反推
// 或 public Sandbox 鸭子类型猜测 provider 行为。

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { defineEval, defineSandbox, defineSandboxAgent } from "../define.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { STATELESS } from "../state/plan.ts";
import { shell } from "../sandbox/commands.ts";
import { prepareRunSandboxes } from "./sandbox-selection.ts";
import { ReusableSandboxPool } from "./sandbox-pool.ts";
import { discoverEval, type AgentRun } from "./types.ts";

const agent = defineSandboxAgent({
  name: "pool-agent",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "pool-agent", version: "1", revision: "1" },
    probe: shell("true"),
  },
  async send() {
    return { events: [], status: "completed" };
  },
});

async function customProviderPlan() {
  let creates = 0;
  const layer = defineSandbox({
    name: "opaque-test-provider",
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    create() {
      creates += 1;
      return Effect.dieMessage("must not materialize an unsupported reusable provider");
    },
  });
  const evalDef = discoverEval(defineEval({ test() {} }), {
    id: "pool/eval",
    baseDir: "/repo/evals/pool",
    sourcePath: "/repo/evals/pool/eval.ts",
    loaderDataPaths: Object.freeze([]),
    criteriaPaths: Object.freeze([]),
    privatePaths: Object.freeze([]),
    source: { path: "eval.ts", content: "", sha256: "source" },
  });
  const run: AgentRun = {
    agent,
    flags: {},
    attempts: 1,
    earlyExit: false,
    sandbox: layer,
    state: STATELESS,
    experimentId: "experiments/pool",
    experimentBaseDir: "/repo/experiments",
    experimentSourcePath: "/repo/experiments/pool.ts",
    selectedEvalIds: [evalDef.id],
  };
  const [prepared] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (prepared === undefined || prepared.plan._tag !== "Sandbox") throw new Error("expected Sandbox plan");
  return { plan: prepared.plan, creates: () => creates };
}

describe("ReusableSandboxPool · pair-owned runtime capability", () => {
  it("opaque custom provider 在物化前明确拒绝 reuse，绝不调用 create", async () => {
    const fixture = await customProviderPlan();
    const pool = new ReusableSandboxPool(
      fixture.plan,
      1,
      { progress() {}, diagnostic() {} },
      { experimentId: "experiments/pool", signal: new AbortController().signal, progress() {}, diagnostic() {}, fact() {} },
    );

    await expect(Effect.runPromise(Effect.scoped(pool.acquire(60_000, new Map())))).rejects.toThrow(/sandboxReuse is unsupported/);
    expect(fixture.creates()).toBe(0);
  });
});
