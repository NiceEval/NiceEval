// rerun: pnpm e2e test --repo cli -- --run test/sandbox-action-debug.test.ts

import { access, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  decodeDebugPlanDocument,
  type DebugPlanDocument,
} from "niceeval/experiment/host";
import { cliE2E } from "./context.ts";

const PRIVATE_ENV_KEY = "NICEEVAL_DEBUG_PRIVATE_TOKEN";
const PRIVATE_ENV_VALUE = "debug-env-value-must-not-leak-91f65d";
const PRIVATE_STDIN = "debug-stdin-must-not-leak-4a360c\n";
const EPHEMERAL_SETUP_PREFIX_REASON =
  "Persistent setup-prefix cache is unsupported for Docker Profile sandboxes and for read-only rootfs or tmpfs surfaces.";

type CommandPlan = DebugPlanDocument["commandPlan"];
type CommandPlanStep = CommandPlan["experiments"][number]["beforeLanes"][number];

function stepsInPlan(commandPlan: CommandPlan): readonly CommandPlanStep[] {
  const steps: CommandPlanStep[] = [];
  const visit = (step: CommandPlanStep): void => {
    steps.push(step);
    for (const child of step.children ?? []) visit(child);
  };
  for (const experiment of commandPlan.experiments) {
    for (const step of experiment.beforeLanes) visit(step);
    for (const lane of experiment.lanes) {
      if ("beforeSlots" in lane) {
        for (const step of lane.beforeSlots) visit(step);
        for (const step of lane.afterSlots) visit(step);
      }
      for (const step of lane.physicalLifecycleTemplate?.enter ?? []) visit(step);
      for (const step of lane.physicalLifecycleTemplate?.exit ?? []) visit(step);
      for (const slot of lane.slots) for (const step of slot.steps) visit(step);
    }
    for (const step of experiment.afterLanes) visit(step);
  }
  return steps;
}

type ActionStep = CommandPlanStep & { readonly action: Exclude<CommandPlanStep["action"], undefined> };

function actionNodes(commandPlan: CommandPlan): readonly ActionStep[] {
  return stepsInPlan(commandPlan).filter((step): step is ActionStep => step.action !== undefined);
}

function requireAction(nodes: readonly ActionStep[], id: string): ActionStep {
  const matches = nodes.filter((node) => actionId(node) === id);
  expect(matches, `action ${JSON.stringify(id)} must occur exactly once in the selected plan`).toHaveLength(1);
  return matches[0]!;
}

function actionId(node: ActionStep): string {
  return node.action.id;
}

function actionPlan(node: ActionStep) {
  expect("family" in node.action, `${node.action.id} must be a normalized Sandbox action`).toBe(true);
  if (!("family" in node.action)) throw new Error(`${node.action.id} must be a normalized Sandbox action`);
  return node.action;
}

function expectOwner(node: CommandPlanStep, kind: string, id: string): void {
  expect(node.owner).toEqual({ kind, id });
  expect(node.declarationOrder, `${id} declarationOrder`).toBeDefined();
  const declarationOrder = node.declarationOrder!;
  expect(declarationOrder.owner).toEqual({ kind, id });
  expect(declarationOrder.ordinal).toEqual(expect.any(Number));
}

function expectPlannedCache(node: CommandPlanStep, id: string) {
  expect(node.cache, `${id} cache`).toBeDefined();
  const cache = node.cache!;
  expect(cache.lookup).toBe("not-probed");
  expect(cache.capability).toBe("unsupported");
  expect(cache.capabilityReason).toBe(EPHEMERAL_SETUP_PREFIX_REASON);
  expect(cache.runtime).toEqual({ status: "pending", finalKey: "not-probed" });
  return cache;
}

function expectScheduledAction(node: CommandPlanStep, id: string, frequency: number): void {
  expect(node.occurrence, `${id} occurrence`).toBeDefined();
  const occurrence = node.occurrence!;
  expect(occurrence.kind).toBe("attempt");
  expect(node.executionOrder, `${id} executionOrder`).toBeDefined();
  const executionOrder = node.executionOrder!;
  expect(executionOrder.topologicalOrdinal).toEqual(expect.any(Number));
  expect(executionOrder.occurrencePath).toEqual(expect.any(Array));
  expect(node.changeFrequency).toEqual(expect.objectContaining({
    value: frequency,
    source: "explicit",
  }));
  expect(typeof node.schedulingReason).toBe("string");
  expectPlannedCache(node, id);
}

test("debug 交付统一且无副作用的 Sandbox action 计划 [necase_NVHTZ20RVFHTJWRJ]", async () => {
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
    const document = decodeDebugPlanDocument(receipt.json<unknown>());
    expect(document).toEqual(expect.objectContaining({
      experimentId: "sandbox-action-debug",
      evalId: "sandbox-action-debug/plan",
      evalIds: ["sandbox-action-debug/plan"],
    }));
    expect(document).not.toHaveProperty("format");
    expect(document).not.toHaveProperty("schemaVersion");
    expect(document.setupPrefixPlan.lookup).toBe("not-probed");
    expect(document.setupPrefixPlan.nodes.every((node) => node.lookup === "not-probed")).toBe(true);

    const nodes = actionNodes(document.commandPlan);
    const byId = new Map(nodes.map((node) => [actionId(node), node]));
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
    expect(dependent.dependencies, "dag-fast-dependent dependencies").toBeDefined();
    const dependencies = dependent.dependencies!;
    expect(dependencies).toHaveLength(1);
    expect(JSON.stringify(dependencies[0])).toContain("dependency-root");
    expect(dependencies[0]).toEqual(expect.objectContaining({ source: "explicit" }));

    const orderedIds = nodes.map((node) => actionId(node));
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
    const exactAction = actionPlan(exact);
    expect(exactAction.family).toBe("@niceeval/e2e-cli/sandbox-action-debug");
    const steps = exactAction.steps;
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
    expect(exactAction.fingerprint.automatic).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/u));
    expect(exactAction.fingerprint.supplemental).not.toBe("none");

    const alphaFingerprint = actionPlan(requireAction(nodes, "fingerprint-prototype-alpha")).fingerprint;
    const prototypeBetaFingerprint = actionPlan(requireAction(nodes, "fingerprint-prototype-beta")).fingerprint;
    const constructorBetaFingerprint = actionPlan(requireAction(nodes, "fingerprint-constructor-beta")).fingerprint;
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

    const builtinAlpha = actionPlan(requireAction(nodes, "builtin-fingerprint-alpha")).fingerprint;
    const builtinBeta = actionPlan(requireAction(nodes, "builtin-fingerprint-beta")).fingerprint;
    expect(builtinAlpha.automatic).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/u));
    expect(builtinBeta.automatic).toBe(builtinAlpha.automatic);
    expect(builtinBeta.supplemental).not.toBe(builtinAlpha.supplemental);
    expect(builtinBeta.combined).not.toBe(builtinAlpha.combined);

    const sensitive = actionPlan(requireAction(nodes, "sensitive-command"));
    expect(sensitive.family).toBe("niceeval.sandbox.command");
    expect(sensitive.input).toEqual(expect.objectContaining({
      envKeysJson: JSON.stringify([PRIVATE_ENV_KEY]),
      envDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      stdinDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      stdinBytes: Buffer.byteLength(PRIVATE_STDIN),
    }));
    const sensitiveSteps = sensitive.steps;
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

    const ensureNodes = stepsInPlan(document.commandPlan).filter((node) => node.phase === "agent.ensure");
    const ensureParents = ensureNodes.filter((node) => node.truth === "conditional");
    expect(ensureParents).toHaveLength(1);
    expect(ensureParents[0]).toEqual(expect.objectContaining({
      truth: "conditional",
      owner: { kind: "agent", id: "cli-sandbox-action-debug" },
    }));
    expect(ensureParents[0]!.action).toBeUndefined();
    expect(ensureParents[0]!.children, "agent.ensure children").toBeDefined();
    const ensureChildren = ensureParents[0]!.children!;
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

    const wholeExperiment = await niceeval.run(["debug", "sandbox-action-debug", "--json"]);
    expect(wholeExperiment.exitCode, wholeExperiment.diagnostic()).toBe(0);
    const wholeDocument = decodeDebugPlanDocument(wholeExperiment.json<unknown>());
    expect(wholeDocument).toEqual(expect.objectContaining({
      experimentId: "sandbox-action-debug",
      evalIds: ["sandbox-action-debug/plan", "sandbox-action-debug/secondary"],
      setupPrefixPlan: expect.objectContaining({ lookup: "not-probed" }),
    }));
    expect(wholeDocument).not.toHaveProperty("evalId");
    expect(new Set(wholeDocument.setupPrefixPlan.nodes.map((node) => node.prefixIdentity)).size)
      .toBe(wholeDocument.setupPrefixPlan.nodes.length);
    const consumerEvalIds = new Set(wholeDocument.setupPrefixPlan.nodes.flatMap((node) =>
      node.consumers.map((consumer) => consumer.evalId)));
    expect(consumerEvalIds).toEqual(new Set([
      "sandbox-action-debug/plan",
      "sandbox-action-debug/secondary",
    ]));
    expect(consumerEvalIds).not.toContain("*");

    await expect(access(sideEffects)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
