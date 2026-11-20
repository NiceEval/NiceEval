import { Effect } from "effect";
import fc from "fast-check";
import { expect, test } from "vitest";

import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { encodeSealedAssertionEntry } from "../assertions/record/attachment.ts";
import { type AgentWorkspaceDiff } from "../assertions/workspace-diff.ts";
import { defineSandboxAgent } from "../define.ts";
import { ManagedAttemptResources } from "../runner/attempt-resources.ts";
import { shell } from "../sandbox/commands.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { createAssertFirstEvalContext } from "./assert-first.ts";

const PATHS = ["a.txt", "b.txt", "nested/c.txt"] as const;

const agent = defineSandboxAgent({
  name: "turn-sandbox-test",
  evidenceCoverage: completeEvidenceCoverage,
  install: { identity: { agent: "turn-sandbox-test", version: "1", revision: "1" }, probe: shell("true") },
  async send() {
    return { status: "completed", events: [] };
  },
});

function setup() {
  return createAssertFirstEvalContext({
    agent,
    // Agent sends and synthetic diff windows in these tests never perform Sandbox I/O.
    sandbox: { workdir: "/workspace", sandboxId: "turn-sandbox-test", otlpHost: null } as Sandbox,
    flags: {},
    signal: new AbortController().signal,
    log: () => {},
    onCleanup: () => {},
    judge: undefined,
    resources: new ManagedAttemptResources(),
    requestEffect: Effect.runPromise,
    executeStop: Effect.runPromise,
    evaluationKind: "pass",
  });
}

function diffFor(turns: readonly (readonly string[])[]): AgentWorkspaceDiff {
  return {
    attribution: "agent-send-window-endpoints",
    policy: { defaultPolicy: "test", include: [], ignore: [] },
    windows: turns.map((paths, index) => ({
      identity: { session: undefined, turn: index + 1 },
      changes: paths.map((path) => ({
        path,
        status: "added",
        before: { state: "absent" },
        after: { state: "text", text: "hello" },
        hunks: { added: ["hello"], removed: [] },
      })),
    })),
  };
}

// @feature docs/feature/sandbox/library/asserting-results.md#限定到某一轮
test("diff assertions read exactly the paths in their send-window scope", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.subarray([...PATHS]), { minLength: 1, maxLength: 3 }), async (turns) => {
      const { context, state } = setup();
      for (const paths of turns) {
        const turn = await context.send("write paths");
        turn.sandbox.changedPaths(paths);
        turn.sandbox.changedPaths(
          paths.includes("a.txt") ? paths.filter((path) => path !== "a.txt") : [...paths, "a.txt"],
        );
      }
      const union = [...new Set(turns.flat())];
      context.sandbox.changedPaths(union);
      state.late.diff = { state: "available", document: diffFor(turns) };

      const { entries } = await Effect.runPromise(state.assertions.seal());
      expect(entries.map(({ result }) => result.state)).toEqual([
        ...turns.flatMap(() => ["matched", "mismatched"]),
        "matched",
      ]);
    }),
    { numRuns: 4, examples: [[[[], ["b.txt"]]], [[["a.txt"], [], ["a.txt", "b.txt"]]]] },
  );
});

// @feature docs/feature/sandbox/library/asserting-results.md#限定到某一轮
test("an absent send window is unavailable even when the Attempt diff has no changes", async () => {
  const { context, state } = setup();
  const turn = await context.send("turn with an empty window");
  const missingTurn = await context.send("turn whose window was not captured");
  turn.sandbox.noChanges();
  missingTurn.sandbox.noChanges();
  context.sandbox.noChanges();
  state.late.diff = { state: "available", document: diffFor([[]]) };

  const { entries } = await Effect.runPromise(state.assertions.seal());
  expect(entries.map(({ result }) => result.state)).toEqual(["matched", "unavailable", "matched"]);
  expect(entries[1]?.criterion).toMatchObject({ window: "turn2" });
  expect(entries[1]?.result).toMatchObject({ reason: "source-unavailable" });
});

test("Attempt-wide changedPaths retains its previous criterion bytes", async () => {
  const { context, state } = setup();
  context.sandbox.changedPaths(["b.txt", "a.txt"]);
  state.late.diff = { state: "available", document: diffFor([["b.txt", "a.txt"]]) };

  const { entries } = await Effect.runPromise(state.assertions.seal());
  const { criterion } = encodeSealedAssertionEntry(entries[0]!);
  if (criterion.state !== "available") throw new Error("Expected a retained criterion");
  const bytes = JSON.stringify(criterion.value);
  expect(bytes).toBe(
    '{"kind":"builtin","id":"sandbox-result","data":{"operation":"changed-paths","paths":["b.txt","a.txt"]}}',
  );
});
