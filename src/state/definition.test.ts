// cases: docs/engineering/testing/unit/experiments-runner.md

import { Cause, Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { Agent } from "../agents/types.ts";
import { defineExperimentState, ExperimentStateDefinitionError, isExperimentStateDefinition } from "./definition.ts";
import { planExperimentState, planExperimentStateOrThrow, StatePlanningError } from "./plan.ts";
import type { ExperimentStateInput } from "./types.ts";

const checkpoint = { identity: { revision: "rev-1" }, facts: {} } as const;

function input(overrides: Partial<ExperimentStateInput> = {}): ExperimentStateInput {
  return {
    identity: { store: "fixture", cohort: "tests", schema: 1 },
    consistency: { mode: "pinned", revision: "rev-1" },
    saveOn: "after-load",
    async load() { return checkpoint; },
    async save() { return checkpoint; },
    ...overrides,
  };
}

const sandboxAgent = { kind: "sandbox", name: "fixture" } as Agent;
const directAgent = { kind: "direct", name: "fixture" } as Agent;

async function planningFailure(effect: ReturnType<typeof planExperimentState>): Promise<StatePlanningError> {
  const exit = await Effect.runPromiseExit(effect);
  if (exit._tag === "Success") throw new Error("expected State planning failure");
  return Option.getOrThrow(Cause.failureOption(exit.cause));
}

function typeContracts(): void {
  const definition = defineExperimentState(input());
  void definition;
  // @ts-expect-error Definition 的私有品牌不能由作者对象字面量伪造。
  const forged: typeof definition = input();
  void forged;
}
void typeContracts;

describe("Experiment State definition and planning", () => {
  it("只接受来源可证、深冻结且 identity 完整的 JSON Definition", () => {
    const identity = { store: "fixture", cohort: "tests", schema: 1, nested: { revision: 2 } };
    const definition = defineExperimentState(input({ identity }));

    expect(isExperimentStateDefinition(definition)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.identity)).toBe(true);
    expect(Object.isFrozen((definition.identity as { nested: object }).nested)).toBe(true);
    identity.nested.revision = 3;
    expect(definition.identity).toMatchObject({ nested: { revision: 2 } });
    expect(isExperimentStateDefinition({ ...definition })).toBe(false);
  });

  it("动态非法 identity 和非法枚举值直接抛领域错误，而不是 FiberFailure", () => {
    const cycle: globalThis.Record<string, unknown> = { store: "fixture", cohort: "tests", schema: 1 };
    cycle.self = cycle;
    expect(() => defineExperimentState(input({ identity: cycle as never }))).toThrow(ExperimentStateDefinitionError);
    expect(() => defineExperimentState(input({ consistency: { mode: "future" } as never }))).toThrowError(
      expect.objectContaining({ code: "state.consistency-invalid" }),
    );
    expect(() => defineExperimentState(input({ saveOn: "sometimes" as never }))).toThrowError(
      expect.objectContaining({ code: "state.save-policy-invalid" }),
    );
  });

  it("把无状态、pinned 和 rolling 规划成穷尽 ADT", () => {
    expect(planExperimentStateOrThrow({
      state: undefined,
      agent: directAgent,
      sandboxReuse: false,
      maxConcurrency: undefined,
    })).toEqual({ _tag: "Stateless" });

    expect(planExperimentStateOrThrow({
      state: defineExperimentState(input()),
      agent: sandboxAgent,
      sandboxReuse: false,
      maxConcurrency: 4,
    })).toMatchObject({ _tag: "Pinned", revision: "rev-1", cadence: "attempt" });

    expect(planExperimentStateOrThrow({
      state: defineExperimentState(input({ consistency: { mode: "rolling" } })),
      agent: sandboxAgent,
      sandboxReuse: true,
      maxConcurrency: 1,
    })).toMatchObject({ _tag: "Rolling", cadence: "window" });
  });

  it("在 provider I/O 前拒绝 Direct、并发 rolling 和不安全 reuse save policy", async () => {
    const pinned = defineExperimentState(input());
    const rolling = defineExperimentState(input({ consistency: { mode: "rolling" } }));
    const afterSuccess = defineExperimentState(input({ saveOn: "attempt-succeeded" }));

    expect((await planningFailure(planExperimentState({
      state: pinned, agent: directAgent, sandboxReuse: false, maxConcurrency: 1,
    }))).code).toBe("state.requires-sandbox-agent");
    expect((await planningFailure(planExperimentState({
      state: rolling, agent: sandboxAgent, sandboxReuse: false, maxConcurrency: 2,
    }))).code).toBe("state.rolling-requires-serial");
    expect((await planningFailure(planExperimentState({
      state: afterSuccess, agent: sandboxAgent, sandboxReuse: true, maxConcurrency: 1,
    }))).code).toBe("state.reuse-requires-after-load");
  });
});
