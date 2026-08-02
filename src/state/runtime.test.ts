// cases: docs/engineering/testing/unit/experiments-runner.md

import { Cause, Effect, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";
import { attemptFailureDeclaration } from "../runner/attempt.ts";
import type { SandboxCommandTarget } from "../sandbox/commands.ts";
import type { CommandResult, SuccessfulCommandResult } from "../sandbox/types.ts";
import { defineExperimentState } from "./definition.ts";
import type { PlannedExperimentState } from "./plan.ts";
import {
  ExperimentStateSequenceFailure,
  ExperimentStateWindow,
  StateWindowTransitionFailure,
  type StateWindowFinalizerInput,
} from "./runtime.ts";

const commandResult: CommandResult = { exitCode: 0, stdout: "", stderr: "" };
const successfulCommandResult: SuccessfulCommandResult = { exitCode: 0, stdout: "", stderr: "" };
const sandbox: SandboxCommandTarget = {
  workdir: "/work",
  async runCommand() { return commandResult; },
  async runShell() { return commandResult; },
  async runCommandOrThrow() { return successfulCommandResult; },
  async runShellOrThrow() { return successfulCommandResult; },
  async readText() { return ""; },
  async writeText() {},
  async readBytes() { return new Uint8Array(); },
  async writeBytes() {},
  async pathExists() { return false; },
  async copyPath() {},
  async putContent() {},
};

const environment = {
  sandbox,
  progress: () => {},
  diagnostic: () => {},
  fact: () => {},
};

const succeeded: StateWindowFinalizerInput = {
  completion: { _tag: "Succeeded" },
  budget: { _tag: "Bounded", timeoutMs: 1_000 },
};

const digestUnavailable = { _tag: "Unavailable" } as const;

function rolling(input: {
  load(context: Parameters<ReturnType<typeof defineExperimentState>["load"]>[0]): Promise<unknown>;
  save(context: Parameters<ReturnType<typeof defineExperimentState>["save"]>[0]): Promise<unknown>;
  saveOn?: "after-load" | "attempt-succeeded";
}): Exclude<PlannedExperimentState, { readonly _tag: "Stateless" }> {
  const definition = defineExperimentState({
    identity: { store: "fixture", cohort: "tests", schema: 1 },
    consistency: { mode: "rolling" },
    saveOn: input.saveOn ?? "after-load",
    load: input.load as never,
    save: input.save as never,
  });
  return { _tag: "Rolling", definition, cadence: "attempt", cohortKey: "fixture" };
}

async function sequenceFailure<A>(
  effect: Effect.Effect<A, ExperimentStateSequenceFailure | StateWindowTransitionFailure>,
): Promise<ExperimentStateSequenceFailure> {
  const exit = await Effect.runPromiseExit(effect);
  if (exit._tag === "Success") throw new Error("expected State sequence failure");
  const failure = Option.getOrThrow(Cause.failureOption(exit.cause));
  if (failure._tag !== "ExperimentStateSequenceFailure") throw failure;
  return failure;
}

describe("Experiment State runtime", () => {
  it("同一个 window 只 load/save 一次，且 checkpoint digest 与 JSON 树完整冻结", async () => {
    let loads = 0;
    let saves = 0;
    const window = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      async load() {
        loads += 1;
        return { identity: { head: 1 }, digest: digestUnavailable, facts: { nested: { value: 1 } } };
      },
      async save() {
        saves += 1;
        return {
          identity: { head: 2 },
          digest: { _tag: "Sha256", value: "a".repeat(64) },
          facts: { nested: { value: 2 } },
        };
      },
    }), "experiment/fixture", "window-1"));

    expect(await Effect.runPromise(window.needsLoad())).toBe(true);
    expect((await Effect.runPromise(window.load(environment)))._tag).toBe("Loaded");
    expect(await Effect.runPromise(window.needsLoad())).toBe(false);
    expect((await Effect.runPromise(window.load(environment)))._tag).toBe("AlreadyLoaded");
    const record = await Effect.runPromise(window.finalize(environment, succeeded));
    expect(await Effect.runPromise(window.finalize(environment, succeeded))).toBe(record);

    expect(loads).toBe(1);
    expect(saves).toBe(1);
    expect(record.load.outcome).toBe("succeeded");
    expect(record.save.outcome).toBe("succeeded");
    if (record.save.outcome === "succeeded") {
      expect(record.save.checkpoint.digest).toEqual({ _tag: "Sha256", value: "a".repeat(64) });
      const nested = record.save.checkpoint.facts.nested;
      expect(typeof nested === "object" && nested !== null && Object.isFrozen(nested)).toBe(true);
    }
    expect(await Effect.runPromise(window.snapshot())).toEqual({ _tag: "Finalized", record });
  });

  it("invalid checkpoint 进入 typed failure，load 失败后绝不调用 save", async () => {
    let saves = 0;
    const window = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      // facts 合法但 digest 缺失，验证 Unavailable 也必须显式写出。
      async load() { return { identity: { head: 1 }, facts: {} }; },
      async save() {
        saves += 1;
        return { identity: {}, digest: digestUnavailable, facts: {} };
      },
    }), "experiment/fixture", "window-2"));

    const failure = await sequenceFailure(window.load(environment));
    expect(failure.failure).toMatchObject({ code: "state.load.invalid-checkpoint" });
    const record = await Effect.runPromise(window.finalize(environment, succeeded));
    expect(saves).toBe(0);
    expect(record.save).toEqual({ outcome: "skipped", reason: "load-failed", durationMs: 0 });
  });

  it("连续性失败经 runner 分类链关闭本 Experiment，原始 transfer failure 不越级止损", async () => {
    const window = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      async load() { throw new Error("state store is unavailable"); },
      async save() { return { identity: {}, digest: digestUnavailable, facts: {} }; },
    }), "experiment/fixture", "window-scope"));

    const failure = await sequenceFailure(window.load(environment));
    expect(attemptFailureDeclaration(undefined, "state.load", failure)).toMatchObject({
      class: { retryable: false, scope: "experiment" },
      phase: "state.load",
    });
    expect(attemptFailureDeclaration(undefined, "state.load", failure.failure)).toBeUndefined();
  });

  it("pinned revision mismatch 保留完整 contract evidence", async () => {
    const definition = defineExperimentState({
      identity: { store: "fixture", cohort: "tests", schema: 1 },
      consistency: { mode: "pinned", revision: "expected" },
      saveOn: "after-load",
      async load() { return { identity: { revision: "actual" }, digest: digestUnavailable, facts: {} }; },
      async save() { return { identity: { revision: "expected" }, digest: digestUnavailable, facts: {} }; },
    });
    const window = await Effect.runPromise(ExperimentStateWindow.make({
      _tag: "Pinned", definition, revision: "expected", cadence: "attempt",
    }, "experiment/fixture", "window-3"));

    const failure = await sequenceFailure(window.load(environment));
    expect(failure.failure).toMatchObject({
      code: "state.pinned-revision-mismatch",
      evidence: { _tag: "ContractViolation", expected: "checkpoint revision \"expected\"" },
    });
  });

  it("attempt completion 用 ADT 决定 save-policy，不接受 boolean 组合", async () => {
    const window = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      saveOn: "attempt-succeeded",
      async load() { return { identity: { head: 1 }, digest: digestUnavailable, facts: {} }; },
      async save() { throw new Error("must not run"); },
    }), "experiment/fixture", "window-4"));

    await Effect.runPromise(window.load(environment));
    const record = await Effect.runPromise(window.finalize(environment, {
      completion: { _tag: "VerdictNotPassed", verdict: "failed" },
      budget: { _tag: "Bounded", timeoutMs: 1_000 },
    }));
    expect(record.save).toEqual({ outcome: "skipped", reason: "save-policy", durationMs: 0 });
  });

  it("Promise throwable 只归一一次为完整 ExternalCause，内部不保留 unknown", async () => {
    const window = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      async load() {
        const error = new Error("store refused read") as Error & { code?: string };
        error.code = "ECONNREFUSED";
        throw error;
      },
      async save() { return { identity: {}, digest: digestUnavailable, facts: {} }; },
    }), "experiment/fixture", "window-5"));

    const failure = await sequenceFailure(window.load(environment));
    expect(failure.failure).toMatchObject({
      kind: "callback",
      evidence: {
        _tag: "External",
        cause: {
          _tag: "ExternalCause",
          name: "Error",
          code: { _tag: "Code", value: "ECONNREFUSED" },
          message: "store refused read",
          stack: { _tag: "Stack" },
        },
      },
    });
  });

  it("Sandbox 终止和 provider 断连分别落 typed unavailable，不冒充 callback failure", async () => {
    const lostSandbox: SandboxCommandTarget = {
      ...sandbox,
      async readText() { throw new Error("Sandbox was terminated"); },
    };
    const lostWindow = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      async load(context) {
        await context.sandbox.readText("/state/checkpoint.json");
        return { identity: {}, digest: digestUnavailable, facts: {} };
      },
      async save() { return { identity: {}, digest: digestUnavailable, facts: {} }; },
    }), "experiment/fixture", "window-sandbox-lost"));
    const lost = await sequenceFailure(lostWindow.load({ ...environment, sandbox: lostSandbox }));
    expect(lost.failure).toMatchObject({
      kind: "unavailable",
      code: "state.load.sandbox-lost",
      evidence: { _tag: "TransferUnavailable", reason: "sandbox-lost" },
    });
    expect(lost.activity).toMatchObject({ outcome: "unavailable", reason: "sandbox-lost" });

    const unreachableSandbox: SandboxCommandTarget = {
      ...sandbox,
      async writeText() {
        throw Object.assign(new Error("connection reset while uploading"), { code: "ECONNRESET" });
      },
    };
    const unreachableWindow = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      async load() { return { identity: {}, digest: digestUnavailable, facts: {} }; },
      async save(context) {
        await context.sandbox.writeText("/state/checkpoint.json", "{}");
        return { identity: {}, digest: digestUnavailable, facts: {} };
      },
    }), "experiment/fixture", "window-provider-unreachable"));
    const unreachableEnvironment = { ...environment, sandbox: unreachableSandbox };
    await Effect.runPromise(unreachableWindow.load(unreachableEnvironment));
    const unreachable = await sequenceFailure(unreachableWindow.finalize(unreachableEnvironment, succeeded));
    expect(unreachable.failure).toMatchObject({
      kind: "unavailable",
      code: "state.save.provider-unreachable",
      evidence: { _tag: "TransferUnavailable", reason: "provider-unreachable" },
    });
    expect(unreachable.activity).toMatchObject({ outcome: "unavailable", reason: "provider-unreachable" });
  });

  it("Sandbox 限流不冒充 provider-unreachable", async () => {
    const throttledSandbox: SandboxCommandTarget = {
      ...sandbox,
      async readText() {
        throw Object.assign(new Error("too many requests"), { status: 429 });
      },
    };
    const window = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      async load(context) {
        await context.sandbox.readText("/state/checkpoint.json");
        return { identity: {}, digest: digestUnavailable, facts: {} };
      },
      async save() { return { identity: {}, digest: digestUnavailable, facts: {} }; },
    }), "experiment/fixture", "window-provider-throttled"));

    const failure = await sequenceFailure(window.load({ ...environment, sandbox: throttledSandbox }));
    expect(failure.failure).toMatchObject({
      kind: "callback",
      code: "state.load.callback",
      evidence: { _tag: "External", cause: { message: "too many requests" } },
    });
  });

  it("save 使用新的有界 signal，超时是 typed unavailable 而不是 interrupt", async () => {
    let loadSignal: AbortSignal | undefined;
    let saveSignal: AbortSignal | undefined;
    const window = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      async load(context) {
        loadSignal = context.signal;
        return { identity: { head: 1 }, digest: digestUnavailable, facts: {} };
      },
      async save(context) {
        saveSignal = context.signal;
        return await new Promise(() => {});
      },
    }), "experiment/fixture", "window-6"));

    await Effect.runPromise(window.load(environment));
    const failure = await sequenceFailure(window.finalize(environment, {
      completion: { _tag: "Succeeded" },
      budget: { _tag: "Bounded", timeoutMs: 10 },
    }));
    expect(saveSignal).not.toBe(loadSignal);
    expect(saveSignal?.aborted).toBe(true);
    expect(failure.failure).toMatchObject({
      kind: "unavailable",
      code: "state.save.deadline-exceeded",
      evidence: { _tag: "TransferUnavailable", reason: "deadline-exceeded" },
    });
    expect(failure.activity).toMatchObject({ outcome: "unavailable", reason: "deadline-exceeded" });
  });

  it("Effect interruption 保持 interrupt cause，不被包装成 typed failure", async () => {
    let entered!: () => void;
    const callbackEntered = new Promise<void>((resolve) => { entered = resolve; });
    let callbackSignal: AbortSignal | undefined;
    const window = await Effect.runPromise(ExperimentStateWindow.make(rolling({
      async load(context) {
        callbackSignal = context.signal;
        entered();
        return await new Promise(() => {});
      },
      async save() { return { identity: {}, digest: digestUnavailable, facts: {} }; },
    }), "experiment/fixture", "window-7"));

    const fiber = Effect.runFork(window.load(environment));
    await callbackEntered;
    const exit = await Effect.runPromise(Fiber.interrupt(fiber));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") expect(Cause.isInterruptedOnly(exit.cause)).toBe(true);
    expect(callbackSignal?.aborted).toBe(true);
    expect(await Effect.runPromise(window.snapshot())).toEqual({ _tag: "Open", stage: "load-interrupted" });
  });
});
