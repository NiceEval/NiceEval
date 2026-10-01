import { Effect } from "effect";
import {
  defineAdapter,
  defineJudge,
} from "niceeval";
import { and, defineValueMatch, defineMaterialMatch, defineContextMatch, defineScoreMatch, type ScoreMatch } from "niceeval/expect";

const limits = { maxAuditBytes: 2 * 1024 * 1024 };
const quality = defineJudge({ name: "style-quality", rubric: "Rate the clarity of the answer.", ...limits });
// A Judge is a ScoreMatch, not a separate kind accepted by another check overload.
const ordinaryMatch: ScoreMatch<unknown> = quality;

interface Event {
  readonly actor: string;
  readonly kind: "speech" | "operation" | "choice";
  readonly text: string;
  readonly adopted: boolean;
}
interface ApplicationContext {
  readHistory(): import("niceeval/expect").MaterialCollection<Event>;
  operations(): import("niceeval/expect").MaterialCollection<Event>;
  dialogue(): import("niceeval/expect").MaterialCollection<Event>;
  operationCount(): number;
}
function source(match: typeof actor) { return defineMaterialMatch<ApplicationContext, Event>({ name: "event-history", read: (ctx) => ctx.readHistory(), match }); }
function materialMatch<T>(material: import("niceeval/expect").MaterialCollection<T>, match: import("niceeval/expect").BooleanMatch<import("niceeval/expect").ReadonlyMaterial<T>, import("niceeval/expect").ReadonlyMaterial<T>>) { return defineMaterialMatch<ApplicationContext, T>({ name: "fixture-history", read: () => material as import("niceeval/expect").MaterialCollection<import("niceeval/expect").ReadonlyMaterial<T>>, match }); }
const actor = defineValueMatch<Event>({ name: "actor-a", evaluate: (event) => event.actor === "a" });
const speech = defineValueMatch<Event>({ name: "speech", evaluate: (event) => event.kind === "speech" });
const unknown = defineValueMatch<Event>({ name: "missing-evidence", evaluate: () => ({ state: "unavailable", reason: "missing-original-request" }) });

export const judgePresetApplication = defineAdapter({
  name: "judge-preset-application",
  create() {
    const items = [
      { id: "event-1", value: { actor: "a", kind: "speech" as const, text: "FIRST_ORIGINAL", adopted: true } },
      { id: "event-2", value: { actor: "b", kind: "speech" as const, text: "OTHER_ACTOR", adopted: true } },
      { id: "event-3", value: { actor: "a", kind: "choice" as const, text: "DISCARDED_ORIGINAL", adopted: false } },
      { id: "event-4", value: { actor: "a", kind: "speech" as const, text: "LAST_ORIGINAL", adopted: true } },
    ];
    return {
      answer: () => "Paris is the capital of France. It has museums. It is on Mars.",
      readHistory: () => ({ state: "complete" as const, items }),
      mutate() { items[0]!.value.text = "MUTATED_HISTORY"; },
      operations: () => ({ state: "complete" as const, items: Array.from({ length: 1000 }, (_, sequence) => ({ id: `operation-${sequence}`, value: { actor: "a", kind: "operation" as const, text: `ORIGINAL_OPERATION_${sequence}: ${"完整执行回执，包括失败、拒绝与调整。".repeat(10)}`, adopted: sequence % 3 !== 0, sequence, status: sequence % 3 === 0 ? "failed" : "completed" } })) }),
      dialogue: () => ({ state: "complete" as const, items: Array.from({ length: 360 }, (_, sequence) => ({ id: `dialogue-${sequence}`, value: { actor: sequence % 2 === 0 ? "a" : "b", kind: "speech" as const, text: `ORIGINAL_DIALOGUE_${sequence}: ${"运输安排需要完整讨论，有理由拒绝也属于有效交流。".repeat(10)}`, adopted: true, sequence, gameSeconds: sequence / 2 } })) }),
      operationCount: () => 1000,

    };
  },
  assertions({ check }) {
    return { hasSpeech() { return check(source(and(actor, speech))); } };
  },
});

const custom = defineScoreMatch<{ output: string }>({
  name: "custom-acceptance",
  version: "1",
  config: { accepted: 0.8, rejected: 0 },
  llm: limits,
  score: (value, ctx) => Effect.gen(function* () {
    const result = yield* ctx.llm.classify({ rubric: "Accept the original output marker.", choices: ["accepted", "rejected"], material: value });
    return result.choice === "accepted" ? 0.8 : 0;
  }),
});

export default judgePresetApplication.defineScoreEval({
  description: "Inspect a combined rubric with classified, decomposed, comparative and free-form scores",
  judge: "judge-eval-override",
  test(t) {
    const output = t.answer();
    t.closeQA(source(actor), "ACCEPT: all original events?", { maxAuditBytes: 1 }).label("Material QA tiny audit");
    t.factuality({ input: "Describe Paris", output, expected: "Paris is the capital of France and has museums." }, limits)
      .score(10).label("Factuality");
    t.faithfulness({ input: "Describe Paris", output, context: "Paris is the capital of France and has museums." }, limits)
      .gate(0.7).score(30).label("Faithfulness");
    t.instructionFollowing({ instructions: ["Name the capital", "Avoid unsupported locations"], output }, limits)
      .score(20).label("Instructions");
    t.pairwisePreference({ instructions: "Explain clearly", output, reference: "Paris is the capital of France." }, limits)
      .score(10).label("Preference");
    t.check({ output }, ordinaryMatch).score(10).label("Quality");
    t.closeQA(source(actor), "ACCEPT: do all these events show participation?", limits)
      .score(2).label("Material QA accepted");
    t.closeQA(source(and(actor, speech)), "REJECT: is every speech complete?", limits)
      .gate(0.8).score(2).label("Material QA rejected");
    t.closeQA(source(actor), "UNKNOWN: do these records prove the original request was complete?", limits)
      .label("Material QA unknown");
    t.closeQA(materialMatch({ state: "complete", items: [] as { id: string; value: Event }[] }, actor), "ACCEPT: did the actor participate?", limits)
      .score(2).label("Material QA empty");
    t.closeQA(materialMatch({ state: "partial", items: [], reason: "missing-journal" }, actor), "ACCEPT: did the actor participate?", limits)
      .label("Material QA partial");
    t.closeQA(source(unknown), "ACCEPT: were the requests adequate?", limits)
      .label("Material QA predicate unknown");
    t.hasSpeech().gate().score(1).label("Material existence");
    t.check(materialMatch({ state: "complete", items: [
      { id: "split-1", value: { actor: "a", kind: "operation", text: "operation", adopted: true } },
      { id: "split-2", value: { actor: "b", kind: "speech", text: "speech", adopted: true } },
    ] }, and(actor, speech))).score(1).label("Same event conjunction");
    t.closeQA(materialMatch({ state: "complete", items: Array.from({ length: 257 }, (_, index) => ({ id: `large-${index}`, value: { actor: "a", kind: "speech" as const, text: "large", adopted: true } })) }, actor), "ACCEPT: is every item natural?", { maxAuditBytes: 8 * 1024 }).label("Material QA over capacity");
    t.closeQA(materialMatch({ state: "complete", items: [{ id: "undefined", value: { actor: "a", original: undefined } }] }, defineValueMatch({ name: "actor-undefined", evaluate: (event: { actor: string; original: undefined }) => event.actor === "a" })), "ACCEPT: is the original available?", { maxAuditBytes: 8 * 1024 }).label("Material QA non JSON");

    const capacity = { maxItems: 4096, maxBytes: 4 * 1024 * 1024, maxNodes: 1048576, maxDepth: 64 };
    const fullOperations = defineMaterialMatch<ApplicationContext, Event>({ name: "operations", read: (ctx) => ctx.operations(), match: actor, capture: capacity });
    const fullDialogue = defineMaterialMatch<ApplicationContext, Event>({ name: "dialogue", read: (ctx) => ctx.dialogue(), match: speech, capture: capacity });
    const wholeJudge = { maxMaterialBytes: 4 * 1024 * 1024, maxAuditBytes: 8 * 1024 * 1024 };
    t.closeQA(fullOperations, "ACCEPT: evaluate all 1000 actual operations including failures", wholeJudge).score(1).label("Whole operations");
    t.closeQA(fullDialogue, "ACCEPT: evaluate the complete two-person 180-second dialogue", wholeJudge).score(1).label("Whole dialogue");
    t.check(defineMaterialMatch<ApplicationContext, Event>({ name: "bounded-witness", read: (ctx) => ctx.operations(), match: actor, capture: { ...capacity, maxItems: 1 } })).gate().label("Capacity known witness");
    t.check(defineMaterialMatch<ApplicationContext, Event>({ name: "bounded-absence", read: (ctx) => ctx.operations(), match: defineValueMatch<Event>({ name: "actor-z", evaluate: (event) => event.actor === "z" }), capture: { ...capacity, maxItems: 1 } })).label("Capacity unknown absence");
    t.check(defineContextMatch<ApplicationContext, { count: number }>({ name: "operation-count", read: (ctx) => ({ state: "available", value: { count: ctx.operationCount() } }), match: defineScoreMatch({ name: "count-efficiency", score: (fact: { count: number }) => fact.count === 1000 ? .6 : 0 }) })).score(1).label("Context fact score");
    t.check(defineContextMatch<ApplicationContext, number>({ name: "unknown-fact", read: () => ({ state: "unavailable", reason: "business-boundary-missing" }), match: defineScoreMatch({ name: "must-not-run", score: (_: number) => { throw new Error("unknown fact invoked scorer"); } }) })).label("Context unknown score");
    t.mutate();
    const customMaterial = { output: "ORIGINAL_CUSTOM_MARKER" };
    t.check(customMaterial, custom).score(20).label("Custom");
    customMaterial.output = "MUTATED_AFTER_CHECK";
  },
});
