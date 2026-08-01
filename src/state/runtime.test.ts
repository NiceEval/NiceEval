// cases: docs/engineering/testing/unit/experiments-runner.md

import { describe, expect, it } from "vitest";
import type { SandboxCommandTarget } from "../sandbox/commands.ts";
import type { CommandResult, SuccessfulCommandResult } from "../sandbox/types.ts";
import { defineExperimentState } from "./definition.ts";
import type { PlannedExperimentState } from "./plan.ts";
import { ExperimentStateSequenceError, ExperimentStateWindow } from "./runtime.ts";

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
  signal: new AbortController().signal,
  progress: () => {},
  diagnostic: () => {},
  fact: () => {},
};

function rolling(input: {
  load(): Promise<unknown>;
  save(): Promise<unknown>;
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

describe("Experiment State runtime", () => {
  it("同一个 reuse window 只 load/save 一次，且 checkpoint 被 Schema 解码并深冻结", async () => {
    let loads = 0;
    let saves = 0;
    const window = new ExperimentStateWindow(rolling({
      async load() {
        loads += 1;
        return { identity: { head: 1 }, facts: { nested: { value: 1 } } };
      },
      async save() {
        saves += 1;
        return { identity: { head: 2 }, facts: { nested: { value: 2 } } };
      },
    }), "experiment/fixture", "window-1");

    expect(window.needsLoad()).toBe(true);
    await window.load(environment);
    expect(window.needsLoad()).toBe(false);
    await window.load(environment);
    const record = await window.finalize(environment, { attemptPassed: false, agentTeardownSucceeded: true });
    await window.finalize(environment, { attemptPassed: true, agentTeardownSucceeded: true });

    expect(loads).toBe(1);
    expect(saves).toBe(1);
    expect(record.load.outcome).toBe("succeeded");
    expect(record.save.outcome).toBe("succeeded");
    if (record.save.outcome === "succeeded") {
      const nested = record.save.checkpoint.facts.nested;
      expect(typeof nested === "object" && nested !== null && Object.isFrozen(nested)).toBe(true);
    }
    expect(window.snapshot()).toEqual({ _tag: "Finalized", record });
  });

  it("invalid checkpoint 进入 typed State failure，load 失败后绝不调用 save", async () => {
    let saves = 0;
    const window = new ExperimentStateWindow(rolling({
      async load() { return { identity: { head: 1 } }; },
      async save() {
        saves += 1;
        return { identity: {}, facts: {} };
      },
    }), "experiment/fixture", "window-2");

    await expect(window.load(environment)).rejects.toMatchObject({
      name: "ExperimentStateSequenceError",
      stateFailure: { code: "state.load.invalid-checkpoint" },
    });
    const record = await window.finalize(environment, { attemptPassed: true, agentTeardownSucceeded: true });
    expect(saves).toBe(0);
    expect(record.save).toEqual({ outcome: "skipped", reason: "load-failed", durationMs: 0 });
  });

  it("pinned revision mismatch 停止序列并保留声明与实际 identity", async () => {
    const definition = defineExperimentState({
      identity: { store: "fixture", cohort: "tests", schema: 1 },
      consistency: { mode: "pinned", revision: "expected" },
      saveOn: "after-load",
      async load() { return { identity: { revision: "actual" }, facts: {} }; },
      async save() { return { identity: { revision: "expected" }, facts: {} }; },
    });
    const window = new ExperimentStateWindow({
      _tag: "Pinned", definition, revision: "expected", cadence: "attempt",
    }, "experiment/fixture", "window-3");

    await expect(window.load(environment)).rejects.toMatchObject({
      stateFailure: { code: "state.pinned-revision-mismatch" },
    });
  });

  it("attempt-succeeded 在失败 verdict 或 teardown 失败时显式记录 save-policy skip", async () => {
    const window = new ExperimentStateWindow(rolling({
      saveOn: "attempt-succeeded",
      async load() { return { identity: { head: 1 }, facts: {} }; },
      async save() { throw new Error("must not run"); },
    }), "experiment/fixture", "window-4");

    await window.load(environment);
    const record = await window.finalize(environment, { attemptPassed: false, agentTeardownSucceeded: true });
    expect(record.save).toEqual({ outcome: "skipped", reason: "save-policy", durationMs: 0 });
  });

  it("save callback failure 关闭窗口并以 ExperimentFatalError 序列错误抛出", async () => {
    const window = new ExperimentStateWindow(rolling({
      async load() { return { identity: { head: 1 }, facts: {} }; },
      async save() { throw new Error("store refused write"); },
    }), "experiment/fixture", "window-5");

    await window.load(environment);
    await expect(window.finalize(environment, { attemptPassed: true, agentTeardownSucceeded: true }))
      .rejects.toBeInstanceOf(ExperimentStateSequenceError);
    expect(window.snapshot()).toMatchObject({
      _tag: "Finalized",
      record: { save: { outcome: "failed", code: "state.save.callback" } },
    });
  });
});
