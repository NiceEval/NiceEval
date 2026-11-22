import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createFixtureProject,
  readJson,
  runSingleAttempt,
  selectInspectionOperation,
  withOperational,
  writeJson,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

const ADAPTER = `
import { defineAdapter } from "niceeval";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const projectFile = (name) => resolve(import.meta.dirname, "..", name);
const NUMBERS = { "@Infinity": Infinity, "@-Infinity": -Infinity, "@NaN": NaN };

export const displayAdapter = defineAdapter({
  name: "display-validation",
  behaviorRevision: "1",
  create(ctx) {
    return {
      async play() {
        const png = await ctx.attach({
          name: "pixel.png",
          mediaType: "image/png",
          body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI1sAAAAASUVORK5CYII=", "base64"),
        });
        const txt = await ctx.attach({ name: "plain.txt", mediaType: "text/plain", body: "not an image" });
        const refs = { "@png": png.artifactId, "@txt": txt.artifactId, "@missing": "attachment-that-was-never-made" };
        const revive = (_key, value) => (typeof value === "string" && value in NUMBERS ? NUMBERS[value] : value);
        const { actions } = JSON.parse(await readFile(projectFile("actions.json"), "utf8"), revive);
        const outcomes = [];
        for (const [index, action] of actions.entries()) {
          const display = action.display === null ? undefined : structuredClone(action.display);
          if (Array.isArray(display)) {
            for (const block of display) {
              if (block !== null && typeof block === "object" && block.artifactId in refs) block.artifactId = refs[block.artifactId];
            }
          }
          try {
            await ctx.recordTrace({
              traceId: "trace-" + index,
              schema: { id: "example.display-property/v1" },
              collection: { state: "complete", limitations: [] },
              scopes: [],
              events: [{
                key: "event",
                type: "observation",
                source: { id: "fixture" },
                summary: action.summary ?? "event-" + index,
                ...(action.payload === undefined ? {} : { payload: action.payload }),
                ...(display === undefined ? {} : { display }),
              }],
            });
            outcomes.push({ accepted: true });
          } catch (error) {
            outcomes.push({ accepted: false, code: error.code, message: error.message });
          }
        }
        await writeFile(projectFile("outcomes.json"), JSON.stringify(outcomes));
        return true;
      },
    };
  },
});
`;

const FILES = {
  "adapters/display.ts": ADAPTER,
  "evals/display.eval.ts": `import { equals } from "niceeval/expect"; import { displayAdapter } from "../adapters/display.ts";
export default displayAdapter.defineEval({ async test(t) { t.check(await t.play(), equals(true)); } });`,
  "experiments/display.ts": `import { defineExperiment } from "niceeval"; import { displayAdapter } from "../adapters/display.ts";
export default defineExperiment({ adapter: displayAdapter, evals: ["display"] });`,
};

// One Experiment run per generated sequence keeps a run within the Library budget; raise the count for nightly exploration.
const PROPERTY_RUNS = Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 1);
const propertyCases = [
  { label: "regression", regression: true },
  ...Array.from({ length: Math.max(0, PROPERTY_RUNS - 2) }, (_, index) => ({
    label: `exploration ${index + 1}`,
    regression: false,
  })),
];

// --- Action generators -------------------------------------------------------------------------

/** Printable text where only the two permitted control characters (tab, newline) appear. */
const safeChar = fc.constantFrom(...Array.from("abcXYZ019 _-.,:;!?()[]{}<>/\\'\"界😀éß\t\n"));
const safeText = fc.array(safeChar, { maxLength: 24 }).map((chars) => chars.join(""));
const safeLabel = fc
  .array(fc.constantFrom(...Array.from("abcXYZ019 _-.界😀")), { minLength: 1, maxLength: 16 })
  .map((chars) => chars.join(""));

const FORBIDDEN_CHARS = [
  "\u0000", "\u0007", "\u001b", "\u007f", "\u0085", "\u009f", // C0 / DEL / C1 controls
  "‪", "‮", "⁦", "⁩", // bidirectional formatting
];
const forbiddenChar = fc.constantFrom(...FORBIDDEN_CHARS);
const taint = (clean: fc.Arbitrary<string>) =>
  fc.tuple(clean, forbiddenChar, clean).map(([a, bad, b]) => `${a}${bad}${b}`);

const scalarValue = fc.oneof(
  safeText,
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

type Block = Record<string, unknown>;
type Display = readonly Block[] | null;

const validBlock: fc.Arbitrary<Block> = fc.oneof(
  safeText.map((text) => ({ kind: "text", text })),
  fc.record({ role: fc.constantFrom("user", "assistant", "system", "other"), text: safeText }).map((r) => ({ kind: "message", ...r })),
  fc
    .record({ role: fc.constantFrom("user", "assistant", "system", "other"), speaker: safeLabel, text: safeText })
    .map((r) => ({ kind: "message", ...r })),
  fc.array(fc.record({ label: safeLabel, value: scalarValue }), { maxLength: 4 }).map((fields) => ({ kind: "fields", fields })),
  fc.record({ text: safeText }).map((r) => ({ kind: "code", ...r })),
  fc.record({ language: safeLabel, text: safeText }).map((r) => ({ kind: "code", ...r })),
  safeLabel.map((alt) => ({ kind: "image", artifactId: "@png", alt })),
);

interface ValidAction {
  readonly valid: true;
  readonly display: Display;
}
interface InvalidAction {
  readonly valid: false;
  readonly category: string;
  readonly display: Display;
}
type Action = ValidAction | InvalidAction;

const validAction: fc.Arbitrary<ValidAction> = fc.oneof(
  fc.constant<Display>(null),
  fc.array(validBlock, { minLength: 1, maxLength: 4 }),
).map((display) => ({ valid: true as const, display }));

function invalid(category: string, display: fc.Arbitrary<Display>): fc.Arbitrary<InvalidAction> {
  return display.map((d) => ({ valid: false as const, category, display: d }));
}

const invalidAction: fc.Arbitrary<InvalidAction> = fc.oneof(
  invalid("empty-array", fc.constant<Display>([])),
  invalid("control-in-text", taint(safeText).map((text) => [{ kind: "text", text }])),
  invalid("control-in-message-text", taint(safeText).map((text) => [{ kind: "message", role: "other", text }])),
  invalid("control-in-speaker", taint(safeLabel).map((speaker) => [{ kind: "message", role: "other", speaker, text: "hi" }])),
  invalid("control-in-code", taint(safeText).map((text) => [{ kind: "code", text }])),
  invalid("control-in-language", taint(safeLabel).map((language) => [{ kind: "code", language, text: "x" }])),
  invalid("control-in-label", taint(safeLabel).map((label) => [{ kind: "fields", fields: [{ label, value: 1 }] }])),
  invalid("control-in-field-value", taint(safeText).map((value) => [{ kind: "fields", fields: [{ label: "k", value }] }])),
  invalid("control-in-alt", taint(safeLabel).map((alt) => [{ kind: "image", artifactId: "@png", alt }])),
  invalid("newline-in-label", safeLabel.map((label) => [{ kind: "fields", fields: [{ label: `${label}\n${label}`, value: 1 }] }])),
  invalid("newline-in-speaker", safeLabel.map((speaker) => [{ kind: "message", role: "user", speaker: `${speaker}\n`, text: "hi" }])),
  invalid("newline-in-alt", safeLabel.map((alt) => [{ kind: "image", artifactId: "@png", alt: `${alt}\n${alt}` }])),
  invalid("non-image-artifact", safeLabel.map((alt) => [{ kind: "image", artifactId: "@txt", alt }])),
  invalid("unknown-artifact", safeLabel.map((alt) => [{ kind: "image", artifactId: "@missing", alt }])),
  invalid("missing-alt", fc.constant<Display>([{ kind: "image", artifactId: "@png" }])),
  invalid("unknown-kind", safeText.map((text) => [{ kind: "html", text }])),
  invalid("unknown-field", safeText.map((text) => [{ kind: "text", text, extra: true }])),
  invalid("non-finite-value", fc.constantFrom("@Infinity", "@-Infinity", "@NaN").map((value) => [{ kind: "fields", fields: [{ label: "v", value }] }])),
  invalid("unknown-role", safeText.map((text) => [{ kind: "message", role: "narrator", text }])),
  invalid("non-object-block", fc.constantFrom(["text"], [42], [null]) as unknown as fc.Arbitrary<Display>),
);

const actionSequence: fc.Arbitrary<readonly Action[]> = fc.array(fc.oneof(validAction, invalidAction), {
  minLength: 6,
  maxLength: 12,
});

// Minimal counterexamples: one legal block plus the control and bidirectional formatting characters that must be rejected.
// At the default run count this sequence is the single run; larger counts keep it as an example beside random ones.
const PINNED_ACTIONS: readonly Action[] = [
  { valid: true, display: [{ kind: "text", text: "Still readable after rejection" }] },
  { valid: false, category: "control-in-text", display: [{ kind: "text", text: "bad\u001b[2J" }] },
  { valid: false, category: "bidi-in-speaker", display: [{ kind: "message", role: "other", speaker: "Guard\u202e", text: "hello" }] },
  { valid: true, display: [{ kind: "code", language: "shell", text: "ls\n\tpwd" }] },
];

// --- Observation -------------------------------------------------------------------------------

interface Outcome {
  readonly accepted: boolean;
  readonly code?: string;
  readonly message?: string;
}

function previewText(block: any): string {
  return block.text.preview;
}

describe("execution display block validation", () => {
  let project: FixtureProject;
  let largeProject: FixtureProject;
  let largeEventLocator: string;
  const largeSummary = "summary".repeat(160);
  const largePayload = { exactText: "界".repeat(350_000), trailing: "last value" };
  const largeDisplay = Array.from({ length: 5 }, (_, index) => ({ kind: "text", text: `block-${index}` }));

  beforeAll(async () => {
    project = await createFixtureProject("niceeval-adapter-display", FILES);
    await writeJson(project.cwd, "actions.json", { actions: [] });
    await runSingleAttempt(project.cwd, "display");

    largeProject = await createFixtureProject("niceeval-adapter-large-trace", FILES);
    await writeJson(largeProject.cwd, "actions.json", {
      actions: [{ summary: largeSummary, payload: largePayload, display: largeDisplay }],
    });
    largeEventLocator = await runSingleAttempt(largeProject.cwd, "display");
    expect(await readJson(largeProject.cwd, "outcomes.json")).toEqual([{ accepted: true }]);
  });
  afterAll(async () => {
    await project?.dispose();
    await largeProject?.dispose();
  });

  // @feature docs/feature/adapters/README.md#display-block-validation
  test.for(propertyCases)(
    "illegal display blocks are rejected with execution-display-invalid and never written, while legal ones read back unchanged ($label)",
    { timeout: 60_000 },
    async ({ regression }) => {
      await fc.assert(
        fc.asyncProperty(actionSequence, async (actions) => {
          await writeJson(project.cwd, "actions.json", { actions });
          const locator = await runSingleAttempt(project.cwd, "display");
          const outcomes = await readJson<readonly Outcome[]>(project.cwd, "outcomes.json");
          const context = JSON.stringify({ actions, outcomes });

          // Rule 1: the error code and path name the offending display, and acceptance equals legality.
          expect(outcomes.map((o) => o.accepted), context).toEqual(actions.map((a) => a.valid));
          for (const [index, outcome] of outcomes.entries()) {
            if (outcome.accepted) continue;
            expect(outcome.code, context).toBe("execution-display-invalid");
            expect(outcome.message, context).toContain(`events[0].display`);
            expect(actions[index]!.valid, context).toBe(false);
          }

          const anyRejected = outcomes.some((o) => !o.accepted);
          const { attempt, execution } = await withOperational(project.cwd, (facts) => ({
            attempt: selectInspectionOperation(facts, { kind: "attempt.get", locator }).attempt,
            execution: selectInspectionOperation(facts, { kind: "attempt.trace", locator }).trace.execution,
          }));

          // Rule 2: a rejected snapshot is a capture failure even though the author caught it.
          expect(attempt.verdict, context).toBe(anyRejected ? "errored" : "passed");
          // With no retained snapshot there is no execution to attach the limitation to, so it is only observable beside kept events.
          if (anyRejected && outcomes.some((o) => o.accepted)) expect(execution.limitations, context).toContainEqual({ code: "capture-failed", stage: "adapter" });
          if (!anyRejected) expect(execution.limitations, context).not.toContainEqual({ code: "capture-failed", stage: "adapter" });

          // Rule 3: nothing from a rejected snapshot is stored; every accepted event is retained in order.
          const accepted = actions.flatMap((action, index) => (action.valid ? [{ action, index }] : []));
          expect(execution.events.map((event) => event.summary), context).toEqual(
            accepted.map(({ index }) => `event-${index}`),
          );

          // Rule 4: accepted display blocks read back with the same kind and text, in order.
          for (const [position, { action }] of accepted.entries()) {
            const stored = execution.events[position]!.display;
            if (action.display === null) {
              expect(stored.state, context).toBe("absent");
              continue;
            }
            expect(stored.state, context).toBe("present");
            if (stored.state !== "present") continue;
            expect(stored.blocks.map((b) => b.kind), context).toEqual(action.display.map((b) => b.kind));
            for (const [blockIndex, block] of action.display.entries()) {
              const readBack = stored.blocks[blockIndex]!;
              if (block.kind === "text" || block.kind === "code" || block.kind === "message") {
                expect(previewText(readBack), context).toBe(block.text);
              }
            }
          }
        }),
        { numRuns: 1, examples: regression ? [[PINNED_ACTIONS]] : [] },
      );
    },
  );
  test("publishes and reads an execution event larger than one SQLite row", async () => {
    await withOperational(largeProject.cwd, (facts) => {
      const locator = largeEventLocator;
      const { execution } = selectInspectionOperation(facts, { kind: "attempt.trace", locator }).trace;
      expect(execution.state).toBe("complete");
      expect(execution.events).toHaveLength(1);
      expect(execution.events[0]).toMatchObject({
        summary: largeSummary.slice(0, 1024),
        omittedSummaryBytes: largeSummary.length - 1024,
      });
      const eventId = execution.events[0]!.eventId;
      const { detail } = selectInspectionOperation(facts, {
        kind: "attempt.trace.detail",
        locator,
        selector: { kind: "execution-event", eventId },
      });
      expect(detail).toMatchObject({
        kind: "execution-event",
        event: { summary: largeSummary, payload: largePayload, display: largeDisplay },
      });
    });
  }, 60_000);

});
