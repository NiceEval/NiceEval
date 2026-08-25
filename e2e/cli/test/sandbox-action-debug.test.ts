// owner: docs/engineering/testing/e2e/cli.md#cli-sandbox-action-debug
// rerun: pnpm e2e test --repo cli -- --run test/sandbox-action-debug.test.ts

import { access, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

type JsonRecord = Record<string, unknown>;

const PRIVATE_ENV_KEY = "NICEEVAL_DEBUG_PRIVATE_TOKEN";
const PRIVATE_ENV_VALUE = "debug-env-value-must-not-leak-91f65d";
const PRIVATE_STDIN = "debug-stdin-must-not-leak-4a360c\n";
const EPHEMERAL_SETUP_PREFIX_REASON =
  "Persistent setup-prefix cache is unsupported for Docker Profile sandboxes and for read-only rootfs or tmpfs surfaces.";

interface DebugPlanDocument {
  readonly format: "niceeval.debug-plan/v1";
  readonly schemaVersion: 1;
  readonly experimentId: string;
  readonly evalId: string;
  readonly commandPlan: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordsInPlan(value: unknown, records: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) recordsInPlan(item, records);
    return records;
  }
  if (!isRecord(value)) return records;
  records.push(value);
  for (const item of Object.values(value)) recordsInPlan(item, records);
  return records;
}

function actionProjection(node: JsonRecord): JsonRecord | undefined {
  return isRecord(node.action) ? node.action : undefined;
}

function actionId(node: JsonRecord): string | undefined {
  const action = actionProjection(node);
  if (typeof action?.id === "string") return action.id;
  return typeof node.actionId === "string" ? node.actionId : undefined;
}

function actionNodes(commandPlan: unknown): JsonRecord[] {
  return recordsInPlan(commandPlan).filter((node) => actionId(node) !== undefined);
}

function requireAction(nodes: readonly JsonRecord[], id: string): JsonRecord {
  const matches = nodes.filter((node) => actionId(node) === id);
  expect(matches, `action ${JSON.stringify(id)} must occur exactly once in the selected plan`).toHaveLength(1);
  return matches[0]!;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  expect(isRecord(value), `${label} must be a structured object`).toBe(true);
  return value as JsonRecord;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  expect(Array.isArray(value), `${label} must be an array`).toBe(true);
  return value as readonly unknown[];
}

function valuesWithKeyPart(value: unknown, part: string, values: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) valuesWithKeyPart(item, part, values);
    return values;
  }
  if (!isRecord(value)) return values;
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase().includes(part.toLowerCase())) values.push(item);
    valuesWithKeyPart(item, part, values);
  }
  return values;
}

function expectOwner(node: JsonRecord, kind: string, id: string): void {
  expect(node.owner).toEqual({ kind, id });
  const declarationOrder = requireRecord(node.declarationOrder, `${id} declarationOrder`);
  expect(declarationOrder.owner).toEqual({ kind, id });
  expect(declarationOrder.ordinal).toEqual(expect.any(Number));
}

function expectPlannedCache(node: JsonRecord, id: string): JsonRecord {
  const cache = requireRecord(node.cache, `${id} cache`);
  expect(cache.lookup).toBe("not-probed");
  expect(cache.capability).toBe("unsupported");
  expect(cache.capabilityReason).toBe(EPHEMERAL_SETUP_PREFIX_REASON);
  expect(cache.runtime).toEqual({ status: "pending", finalKey: "not-probed" });
  return cache;
}

function expectScheduledAction(node: JsonRecord, id: string, frequency: number): void {
  const occurrence = requireRecord(node.occurrence, `${id} occurrence`);
  expect(occurrence.kind).toBe("attempt");
  const executionOrder = requireRecord(node.executionOrder, `${id} executionOrder`);
  expect(executionOrder.topologicalOrdinal).toEqual(expect.any(Number));
  expect(executionOrder.occurrencePath).toEqual(expect.any(Array));
  expect(node.changeFrequency).toEqual(expect.objectContaining({
    value: frequency,
    source: "explicit",
  }));
  expect(typeof node.schedulingReason).toBe("string");
  expectPlannedCache(node, id);
}

test("debug 交付统一且无副作用的 Sandbox action 计划", async () => {
  await cliE2E.case("sandbox-action-debug", async ({ commands: { niceeval }, paths }) => {
    const sideEffects = join(paths.projectRoot, "sandbox-action-debug-side-effects.ndjson");
    const receipt = await niceeval.run([
      "debug",
      "sandbox-action-debug",
      "sandbox-action-debug/plan",
      "--json",
    ]);

    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    expect(receipt.stderr).toBe("");
    const document = receipt.json<DebugPlanDocument>();
    expect(document).toEqual(expect.objectContaining({
      format: "niceeval.debug-plan/v1",
      schemaVersion: 1,
      experimentId: "sandbox-action-debug",
      evalId: "sandbox-action-debug/plan",
    }));

    const nodes = actionNodes(document.commandPlan);
    const byId = new Map(nodes.map((node) => [actionId(node)!, node]));
    expect([...byId.keys()]).toEqual(expect.arrayContaining([
      "frequency-low",
      "frequency-high",
      "dependency-root",
      "dag-fast-dependent",
      "fingerprint-prototype-alpha",
      "fingerprint-prototype-beta",
      "fingerprint-constructor-beta",
      "builtin-fingerprint-alpha",
      "builtin-fingerprint-beta",
      "tie-experiment-first",
      "tie-experiment-second",
      "tie-eval-group",
      "tie-eval",
      "tie-agent",
      "agent-frequency-first",
      "sensitive-command",
      "opaque-barrier",
      "opaque-suffix",
    ]));

    expectOwner(requireAction(nodes, "tie-experiment-first"), "experiment", "sandbox-action-debug");
    expectOwner(requireAction(nodes, "tie-eval-group"), "eval-group", "sandbox-action-debug");
    expectOwner(requireAction(nodes, "tie-eval"), "eval", "sandbox-action-debug/plan");
    expectOwner(requireAction(nodes, "tie-agent"), "agent", "cli-sandbox-action-debug");

    for (const [id, frequency] of [
      ["frequency-low", 10],
      ["frequency-high", 40],
      ["dependency-root", 50],
      ["dag-fast-dependent", 1],
      ["fingerprint-prototype-alpha", 20],
      ["fingerprint-prototype-beta", 20],
      ["fingerprint-constructor-beta", 20],
      ["builtin-fingerprint-alpha", 20],
      ["builtin-fingerprint-beta", 20],
      ["tie-experiment-first", 100],
      ["tie-experiment-second", 100],
      ["tie-eval-group", 100],
      ["tie-eval", 100],
      ["tie-agent", 100],
      ["agent-frequency-first", 5],
      ["opaque-suffix", 300],
    ] as const) {
      expectScheduledAction(requireAction(nodes, id), id, frequency);
    }

    const dependent = requireAction(nodes, "dag-fast-dependent");
    const dependencies = requireArray(dependent.dependencies, "dag-fast-dependent dependencies");
    expect(dependencies).toHaveLength(1);
    expect(JSON.stringify(dependencies[0])).toContain("dependency-root");
    expect(dependencies[0]).toEqual(expect.objectContaining({ source: "explicit" }));

    const orderedIds = nodes.map((node) => actionId(node)!);
    const index = (id: string): number => orderedIds.indexOf(id);
    expect(index("frequency-low")).toBeLessThan(index("frequency-high"));
    expect(index("agent-frequency-first")).toBeLessThan(index("frequency-low"));
    expect(index("dependency-root")).toBeLessThan(index("dag-fast-dependent"));
    expect([
      index("tie-experiment-first"),
      index("tie-experiment-second"),
      index("tie-eval-group"),
      index("tie-eval"),
      index("tie-agent"),
    ]).toEqual([...[
      index("tie-experiment-first"),
      index("tie-experiment-second"),
      index("tie-eval-group"),
      index("tie-eval"),
      index("tie-agent"),
    ]].sort((left, right) => left - right));

    const exact = requireAction(nodes, "tie-experiment-first");
    expect(exact.truth).toBe("exact");
    const exactAction = requireRecord(exact.action, "tie-experiment-first action");
    expect(exactAction.family).toBe("@niceeval/e2e-cli/sandbox-action-debug");
    const steps = requireArray(exactAction.steps, "tie-experiment-first steps");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      kind: "exec",
      executable: "printf",
      args: ["%s", "tie-experiment-first"],
    });
    expect(steps[1]).toEqual(expect.objectContaining({
      kind: "putText",
      path: ".debug-plan/tie-experiment-first.txt",
      digest: expect.stringMatching(/^sha256:/),
      bytes: "tie-experiment-first".length,
    }));
    expect(valuesWithKeyPart(exactAction, "automatic")).not.toEqual([]);
    const supplemental = valuesWithKeyPart(exactAction, "supplemental");
    expect(supplemental).not.toEqual([]);
    expect(supplemental.every((value) => value !== null && value !== "none")).toBe(true);

    const prototypeAlpha = requireRecord(
      requireAction(nodes, "fingerprint-prototype-alpha").action,
      "fingerprint-prototype-alpha action",
    );
    const prototypeBeta = requireRecord(
      requireAction(nodes, "fingerprint-prototype-beta").action,
      "fingerprint-prototype-beta action",
    );
    const constructorBeta = requireRecord(
      requireAction(nodes, "fingerprint-constructor-beta").action,
      "fingerprint-constructor-beta action",
    );
    const alphaFingerprint = requireRecord(prototypeAlpha.fingerprint, "prototype alpha fingerprint");
    const prototypeBetaFingerprint = requireRecord(
      prototypeBeta.fingerprint,
      "prototype beta fingerprint",
    );
    const constructorBetaFingerprint = requireRecord(
      constructorBeta.fingerprint,
      "constructor beta fingerprint",
    );
    expect([
      alphaFingerprint.automatic,
      prototypeBetaFingerprint.automatic,
      constructorBetaFingerprint.automatic,
    ]).toEqual([
      alphaFingerprint.automatic,
      alphaFingerprint.automatic,
      alphaFingerprint.automatic,
    ]);
    expect(new Set([
      alphaFingerprint.supplemental,
      prototypeBetaFingerprint.supplemental,
      constructorBetaFingerprint.supplemental,
    ]).size).toBe(3);
    expect(new Set([
      alphaFingerprint.combined,
      prototypeBetaFingerprint.combined,
      constructorBetaFingerprint.combined,
    ]).size).toBe(3);

    const builtinAlpha = requireRecord(
      requireRecord(requireAction(nodes, "builtin-fingerprint-alpha").action, "builtin alpha action").fingerprint,
      "builtin alpha fingerprint",
    );
    const builtinBeta = requireRecord(
      requireRecord(requireAction(nodes, "builtin-fingerprint-beta").action, "builtin beta action").fingerprint,
      "builtin beta fingerprint",
    );
    expect(builtinAlpha.automatic).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/u));
    expect(builtinBeta.automatic).toBe(builtinAlpha.automatic);
    expect(builtinBeta.supplemental).not.toBe(builtinAlpha.supplemental);
    expect(builtinBeta.combined).not.toBe(builtinAlpha.combined);

    const sensitive = requireRecord(requireAction(nodes, "sensitive-command").action, "sensitive-command action");
    expect(sensitive.family).toBe("niceeval.sandbox.command");
    const sensitiveInput = requireRecord(sensitive.input, "sensitive-command input");
    expect(sensitiveInput.envKeysJson).toBe(JSON.stringify([PRIVATE_ENV_KEY]));
    expect(sensitiveInput.envDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/u));
    expect(sensitiveInput.stdinDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/u));
    expect(sensitiveInput.stdinBytes).toBe(Buffer.byteLength(PRIVATE_STDIN));
    const sensitiveSteps = requireArray(sensitive.steps, "sensitive-command steps");
    expect(sensitiveSteps).toEqual([
      expect.objectContaining({
        kind: "exec",
        envKeys: [PRIVATE_ENV_KEY],
        stdinDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        stdinBytes: Buffer.byteLength(PRIVATE_STDIN),
      }),
    ]);
    const serializedPlan = JSON.stringify(document);
    expect(serializedPlan).toContain(PRIVATE_ENV_KEY);
    expect(serializedPlan).not.toContain(PRIVATE_ENV_VALUE);
    expect(serializedPlan).not.toContain(PRIVATE_STDIN.trim());

    const barrier = requireAction(nodes, "opaque-barrier");
    expect(barrier.truth).toBe("opaque");
    expect(index("opaque-barrier")).toBeLessThan(index("opaque-suffix"));
    const suffixCache = expectPlannedCache(requireAction(nodes, "opaque-suffix"), "opaque-suffix");
    expect(JSON.stringify(suffixCache.eligibility)).toContain("opaque-ancestor");

    const ensureNodes = recordsInPlan(document.commandPlan).filter((node) => node.phase === "agent.ensure");
    const ensureParents = ensureNodes.filter((node) => node.truth === "conditional");
    expect(ensureParents).toHaveLength(1);
    expect(ensureParents[0]).toEqual(expect.objectContaining({
      truth: "conditional",
      owner: { kind: "agent", id: "cli-sandbox-action-debug" },
    }));
    expect(actionId(ensureParents[0]!)).toBeUndefined();
    const ensureChildren = requireArray(ensureParents[0]!.children, "agent.ensure children")
      .map((child, index) => requireRecord(child, `agent.ensure child ${index}`));
    expect(ensureChildren).toHaveLength(2);
    expect(ensureChildren[0]).toEqual(expect.objectContaining({
      phase: "agent.ensure",
      truth: "opaque",
      label: "probe #0",
      owner: { kind: "agent", id: "cli-sandbox-action-debug" },
    }));
    expect(ensureChildren[1]).toEqual(expect.objectContaining({
      phase: "agent.ensure",
      truth: "known-no-command",
      label: "install #0",
      owner: { kind: "agent", id: "cli-sandbox-action-debug" },
      condition: expect.objectContaining({ code: "probe-miss" }),
    }));
    expect(ensureNodes).toHaveLength(1 + ensureChildren.length);
    expect(nodes.some((node) => actionId(node) === "debug-agent-probe")).toBe(false);

    const human = await niceeval.run([
      "debug",
      "sandbox-action-debug",
      "sandbox-action-debug/plan",
    ]);
    expect(human.exitCode, human.diagnostic()).toBe(0);
    expect(human.stderr).toBe("");
    expect(human.stdout).toContain("COMMAND PLAN");
    expect(human.stdout).toContain("agent.ensure");
    expect(human.stdout).toContain("action: frequency-low");
    expect(human.stdout).toContain("change frequency: 10 · explicit · rare");
    expect(human.stdout).toContain("action: dag-fast-dependent");
    expect(human.stdout).toContain("change frequency: 1 · explicit");
    expect(human.stdout).toContain("execution order: #");
    expect(human.stdout).toContain("cache: not-probed · unsupported · runtime pending · final key not-probed");
    expect(human.stdout.replace(/\s+/gu, "")).toContain(
      `cache unsupported reason: ${EPHEMERAL_SETUP_PREFIX_REASON}`.replace(/\s+/gu, ""),
    );
    expect(human.stdout).not.toContain(" · eligible");
    expect(human.stdout).not.toContain(" · ineligible:");
    expect(human.stdout.indexOf("action: frequency-low"))
      .toBeLessThan(human.stdout.indexOf("action: frequency-high"));
    expect(human.stdout.indexOf("action: agent-frequency-first"))
      .toBeLessThan(human.stdout.indexOf("action: frequency-low"));
    expect(human.stdout.indexOf("action: dependency-root"))
      .toBeLessThan(human.stdout.indexOf("action: dag-fast-dependent"));
    expect([
      human.stdout.indexOf("action: tie-experiment-first"),
      human.stdout.indexOf("action: tie-experiment-second"),
      human.stdout.indexOf("action: tie-eval-group"),
      human.stdout.indexOf("action: tie-eval"),
      human.stdout.indexOf("action: tie-agent"),
    ]).toEqual([...[
      human.stdout.indexOf("action: tie-experiment-first"),
      human.stdout.indexOf("action: tie-experiment-second"),
      human.stdout.indexOf("action: tie-eval-group"),
      human.stdout.indexOf("action: tie-eval"),
      human.stdout.indexOf("action: tie-agent"),
    ]].sort((left, right) => left - right));
    expect(human.stdout).toContain("step #0: argv");
    expect(human.stdout).toContain("step #1: putText");
    expect(human.stdout).toContain(`environment keys: [${JSON.stringify(PRIVATE_ENV_KEY)}`);
    expect(human.stdout).toContain("stdin: sha256:");
    expect(human.stdout).not.toContain(PRIVATE_ENV_VALUE);
    expect(human.stdout).not.toContain(PRIVATE_STDIN.trim());

    await copyFile(
      join(paths.projectRoot, "fixtures", "sandbox-action-debug-invalid.ts"),
      join(paths.projectRoot, "experiments", "sandbox-action-debug-invalid.ts"),
    );
    const invalid = await niceeval.run([
      "debug",
      "sandbox-action-debug-invalid",
      "sandbox-action-debug/plan",
      "--json",
    ]);
    expect(invalid.exitCode, invalid.diagnostic()).not.toBe(0);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("sandbox.before-planning-failed");
    expect(invalid.stderr).toContain("dependency-cycle");
    expect(invalid.stderr).toContain("invalid-cycle-a");
    expect(invalid.stderr).toContain("invalid-cycle-b");
    expect(invalid.stderr).not.toContain("defect");

    await expect(access(sideEffects)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
