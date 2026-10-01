import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("单模型简写使用冻结 default 选择及其别名", async () => {
  const experimentId = "model-default-shorthand";
  const bindings = [{ modelSlot: "default", model: "fixture/default", reasoningEffort: "high", recordedCalls: 0 }];
  await evalE2E.case(experimentId, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-slot-selection", run.diagnostic());
    expect(event.verdict).toBe("passed");
    const request = join(paths.projectRoot, "selection.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage).toMatchObject({ configuredModels: { state: "available", bindings } });
    expect(usage.calls).toEqual([
      expect.objectContaining({ callId: "unattributed", modelSlot: null }),
      expect.objectContaining({ callId: "explicit-null", modelSlot: null }),
    ]);
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("显式 default 使用冻结选择及相同别名", async () => {
  const experimentId = "model-default-explicit";
  const bindings = [{ modelSlot: "default", model: "fixture/default", reasoningEffort: "high", recordedCalls: 0 }];
  await evalE2E.case(experimentId, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-slot-selection", run.diagnostic());
    expect(event.verdict).toBe("passed");
    const request = join(paths.projectRoot, "selection.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage).toMatchObject({ configuredModels: { state: "available", bindings } });
    expect(usage.calls).toEqual([
      expect.objectContaining({ callId: "unattributed", modelSlot: null }),
      expect.objectContaining({ callId: "explicit-null", modelSlot: null }),
    ]);
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("仅推理强度保留 null 模型与冻结 default 别名", async () => {
  const experimentId = "model-effort-only";
  const bindings = [{ modelSlot: "default", model: null, reasoningEffort: "high", recordedCalls: 0 }];
  await evalE2E.case(experimentId, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-slot-selection", run.diagnostic());
    expect(event.verdict).toBe("passed");
    const request = join(paths.projectRoot, "selection.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage).toMatchObject({ configuredModels: { state: "available", bindings } });
    expect(usage.calls).toEqual([
      expect.objectContaining({ callId: "unattributed", modelSlot: null }),
      expect.objectContaining({ callId: "explicit-null", modelSlot: null }),
    ]);
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("省略模型配置保留冻结空映射及空别名", async () => {
  const experimentId = "model-omitted";
  const bindings = [] as const;
  await evalE2E.case(experimentId, async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-slot-selection", run.diagnostic());
    expect(event.verdict).toBe("passed");
    const request = join(paths.projectRoot, "selection.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const usage = read.querySuccess("attempt.usage").usage;
    expect(usage).toMatchObject({ configuredModels: { state: "available", bindings } });
    expect(usage.calls).toEqual([
      expect.objectContaining({ callId: "unattributed", modelSlot: null }),
      expect.objectContaining({ callId: "explicit-null", modelSlot: null }),
    ]);
  });
});
