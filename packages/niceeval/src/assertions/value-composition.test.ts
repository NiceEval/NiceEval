// cases: docs/engineering/testing/unit/assertions.md
// Pure combination edge cases that cannot be enumerated reliably through an installed Eval.
import { expect, expectTypeOf, test } from "vitest";
import {
  countWhere, defineValueMatch, equals, evaluateBooleanMatch, filterWhere, mapEach, mapValue,
  satisfies, defineScoreMatch, toolMatch, eventMatch, and, or, not, inOrder, type BooleanMatch, type CollectionValue,
} from "./match.ts";
import { defineContextMatch, type MaterialCollection } from "./context-match.ts";

test("literal predicates accept broad candidates and projected subjects retain their refinement", async () => {
  const counted = countWhere(equals(0), equals(3));
  const value = [0, 1, 0, 0];
  const result = await evaluateBooleanMatch(counted, value);
  expect(result.state).toBe("matched");
  if (result.state === "matched") expect(result.value).toBe(value);

  type Npc = { readonly kind: "npc"; readonly hp: readonly number[] };
  type Actor = Npc | { readonly kind: "other" };
  const npcMatch = satisfies<Actor, Npc>("npc", (actor): actor is Npc => actor.kind === "npc");
  const hpMatch = mapValue("hp", (npc: Npc) => npc.hp, countWhere(equals(0), equals(3)));
  expectTypeOf(hpMatch).toEqualTypeOf<BooleanMatch<Npc, Npc>>();
  expectTypeOf(npcMatch).toEqualTypeOf<BooleanMatch<Actor, Npc>>();
  const actorHp = mapValue("hp", (actor: Actor): CollectionValue<number> => actor.kind === "npc" ? actor.hp : { state: "unavailable", reason: "not-npc" }, countWhere(equals(0), equals(3)));
  const composed = and(npcMatch, actorHp);
  expectTypeOf(composed).toMatchTypeOf<BooleanMatch<Actor, Npc>>();
  const npc: Npc = { kind: "npc", hp: value };
  const mapped = await evaluateBooleanMatch(hpMatch, npc);
  if (mapped.state === "matched") expect(mapped.value).toBe(npc);
  else throw new Error("Expected a matching original NPC");
});

test("incomplete collections never evaluate items, projections or aggregates", async () => {
  const calls: string[] = [];
  const item = defineValueMatch<number>({ name: "item", evaluate: () => { calls.push("item"); return true; } });
  const aggregate = defineValueMatch<CollectionValue<number>>({ name: "aggregate", evaluate: () => { calls.push("aggregate"); return true; } });
  const count = defineValueMatch<number>({ name: "count", evaluate: () => { calls.push("count"); return true; } });
  const projected = mapEach((value: number) => { calls.push("projection"); return value; }, aggregate);
  for (const state of ["partial", "unavailable"] as const) {
    const subject: MaterialCollection<number> = state === "partial"
      ? { state, reason: "producer-incomplete", items: [{ id: "one", value: 1 }] }
      : { state, reason: "producer-incomplete" };
    for (const match of [countWhere(item, count), filterWhere(item, aggregate), projected]) {
      expect(await evaluateBooleanMatch(match, subject)).toMatchObject({ state: "unavailable", reason: "producer-incomplete" });
    }
  }
  expect(calls).toEqual([]);
});

test("unknown values and array holes cannot become exact counts", async () => {
  const count = countWhere(equals(0), equals(0));
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: 1 }));
  for (const subject of [[undefined], [null], [NaN], [Infinity], [-Infinity], new Array(1), inherited]) {
    expect(await evaluateBooleanMatch(count, subject)).toMatchObject({ state: "unavailable" });
  }
  expect(await evaluateBooleanMatch(count, [])).toMatchObject({ state: "matched", value: [] });
});

test("unknown selectors prevent filtering from presenting a complete subset", async () => {
  let aggregated = false;
  const selector = defineValueMatch<number>({ name: "selector", evaluate: (value) => value === 2
    ? { state: "unavailable", reason: "unknown-selector" } : value === 1 });
  const aggregate = defineValueMatch<CollectionValue<number>>({ name: "aggregate", evaluate: () => { aggregated = true; return true; } });
  const subject = { state: "complete", items: [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }] } as const;
  const result = await evaluateBooleanMatch(filterWhere(selector, aggregate), subject);
  expect(result).toMatchObject({ state: "unavailable", reason: "unknown-selector", diagnostic: { children: [
    { index: 0, label: "a", state: "matched" }, { index: 1, label: "b", state: "unavailable" }, { index: 2, label: "c", state: "mismatched" },
  ] } });
  expect(aggregated).toBe(false);
});

test("filtering and mapping preserve material identity, source positions and original subject", async () => {
  const first = { n: 1 }, last = { n: 3 };
  const subject = { state: "complete", items: [{ id: "first", value: first }, { id: "middle", value: { n: 2 } }, { id: "last", value: last }] } as const;
  const aggregate = defineValueMatch<CollectionValue<{ readonly n: number }>>({ name: "subset", evaluate: (value) => {
    expect(value).toEqual({ state: "complete", items: [{ id: "first", value: first }, { id: "last", value: last }] });
    if ("state" in value && value.state === "complete") expect(value.items[0].value).toBe(first);
    return true;
  } });
  const filtered = await evaluateBooleanMatch(filterWhere(satisfies("odd", (value: { readonly n: number }) => value.n % 2 === 1), aggregate), subject);
  expect(filtered).toMatchObject({ state: "matched", diagnostic: { children: [
    { index: 0, label: "first" }, { index: 1, label: "middle" }, { index: 2, label: "last" }, { label: "aggregate", state: "matched" },
  ] } });
  if (filtered.state === "matched") expect(filtered.value).toBe(subject);
  const mapped = await evaluateBooleanMatch(mapEach((value: { readonly n: number }) => value.n, equals({ state: "complete", items: [
    { id: "first", value: 1 }, { id: "middle", value: 2 }, { id: "last", value: 3 },
  ] })), subject);
  expect(mapped.state).toBe("matched");
  if (mapped.state === "matched") expect(mapped.value).toBe(subject);
});

test("missing and nonfinite projections cannot be accepted by permissive inner matches", async () => {
  const inner = defineValueMatch<unknown>({ name: "permissive", evaluate: () => { throw new Error("Must not evaluate unknown projection"); } });
  for (const value of [undefined, null, NaN, Infinity, -Infinity]) {
    expect(await evaluateBooleanMatch(mapValue("projection", (_: number) => value, inner), 1)).toMatchObject({ state: "unavailable" });
    expect(await evaluateBooleanMatch(mapEach((_: number) => value, inner), [1])).toMatchObject({ state: "unavailable" });
  }
});

test("projection and matcher exceptions remain execution errors", async () => {
  const defect = new Error("projection defect");
  await expect(evaluateBooleanMatch(mapValue("throw", (_: number): number => { throw defect; }, equals(0)), 1)).rejects.toBe(defect);
  await expect(evaluateBooleanMatch(mapEach((_: number): number => { throw defect; }, equals([])), [1])).rejects.toBe(defect);
  const broken = defineValueMatch<number>({ name: "broken", evaluate: () => { throw defect; } });
  await expect(evaluateBooleanMatch(countWhere(broken, equals(0)), [1])).rejects.toBe(defect);
  await expect(evaluateBooleanMatch(filterWhere(broken, equals([])), [1])).rejects.toBe(defect);
  await expect(evaluateBooleanMatch(mapValue("async", (_: number) => Promise.resolve(1), equals(1)), 1)).rejects.toThrow("synchronous value");
});

test("combinators reject fabricated, score and domain matches at construction", () => {
  const raw = { name: "raw", kind: "boolean", domain: "value" } as unknown as BooleanMatch<number, number>;
  expect(() => countWhere(raw, equals(0))).toThrow("created by niceeval/expect");
  expect(() => filterWhere(raw, equals([]))).toThrow("created by niceeval/expect");
  expect(() => mapValue("raw", (value: number) => value, raw)).toThrow("created by niceeval/expect");
  expect(() => mapEach((value: number) => value, raw as unknown as BooleanMatch<CollectionValue<number>, CollectionValue<number>>)).toThrow("created by niceeval/expect");
  expect(() => mapValue("domain", (value: unknown) => value, toolMatch("tool") as unknown as BooleanMatch<unknown, unknown>)).toThrow("value domain");
  const score = defineScoreMatch<number>({ name: "score", score: () => 1 });
  expect(() => countWhere(score as unknown as BooleanMatch<number, number>, equals(0))).toThrow("BooleanMatch");
  const stringOnly = defineValueMatch<string>({ name: "string", evaluate: () => true });
  // @ts-expect-error A string-only match cannot consume a projected number.
  mapValue("typed", (value: number) => value, stringOnly);
});

test.each([
  { subject: [1, 2], state: "matched" },
  { subject: [1, 0, 2], state: "matched" },
  { subject: [2, 1], state: "mismatched" },
  { subject: [], state: "mismatched" },
  { subject: [1], state: "mismatched" },
  { subject: [undefined, 1, 2], state: "matched" },
  { subject: [1, undefined, 2], state: "matched" },
  { subject: [undefined, 2], state: "unavailable" },
  { subject: [1, undefined], state: "unavailable" },
  { subject: [undefined, 0], state: "mismatched" },
  { subject: [0, undefined], state: "mismatched" },
  { subject: [undefined], state: "mismatched" },
  { subject: [undefined, undefined], state: "unavailable" },
  { subject: [null, 2], state: "unavailable" },
  { subject: [NaN, 2], state: "unavailable" },
  { subject: [Infinity, 2], state: "unavailable" },
  { subject: [-Infinity, 2], state: "unavailable" },
])("ordered values distinguish known witnesses and possible chains: $subject -> $state", async ({ subject, state }) => {
  const result = await evaluateBooleanMatch(inOrder([equals(1), equals(2)]), subject);
  expect(result.state).toBe(state);
  if (result.state === "matched") expect(result.value).toBe(subject);
});

test("ordered steps require distinct items and compose alternative sequences and negation", async () => {
  const repeated = inOrder([equals(1), equals(1)]);
  expect(await evaluateBooleanMatch(repeated, [1])).toMatchObject({ state: "mismatched" });
  expect(await evaluateBooleanMatch(repeated, [1, 1])).toMatchObject({ state: "matched" });
  expect(await evaluateBooleanMatch(inOrder([equals(1), equals(2), equals(3)]), [1, 0, 2, 0, 3])).toMatchObject({ state: "matched" });
  expect(await evaluateBooleanMatch(inOrder([equals(1), equals(2), equals(3)]), [1, undefined, 3])).toMatchObject({ state: "unavailable" });
  const alternatives = or(inOrder([equals(1), equals(2)]), inOrder([equals(3), equals(4)]));
  expect(await evaluateBooleanMatch(alternatives, [3, 0, 4])).toMatchObject({ state: "matched" });
  expect(await evaluateBooleanMatch(alternatives, [4, 3])).toMatchObject({ state: "mismatched" });
  expect(await evaluateBooleanMatch(not(repeated), [1])).toMatchObject({ state: "matched" });
  expect(await evaluateBooleanMatch(not(repeated), [undefined, 1])).toMatchObject({ state: "unavailable" });
});

test("array holes remain unknown candidates even with inherited values", async () => {
  const hole = new Array<unknown>(2);
  hole[1] = 2;
  const inherited = new Array<unknown>(2);
  inherited[1] = 2;
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: 0 }));
  for (const subject of [hole, inherited]) {
    expect(await evaluateBooleanMatch(inOrder([equals(1), equals(2)]), subject)).toMatchObject({ state: "unavailable" });
  }
});

test("a conjunction inside an ordered step constrains the same committed event", async () => {
  type GameEvent = { readonly type: "heard" | "movement"; readonly listener: string; readonly adopted: boolean };
  const hearing = satisfies<GameEvent>("hearing", event => event.type === "heard");
  const listener = satisfies<GameEvent>("listener-b", event => event.listener === "b");
  const movement = satisfies<GameEvent>("adopted movement", event => event.type === "movement" && event.adopted);
  const order = inOrder([and(hearing, listener), movement]);
  const moved: GameEvent = { type: "movement", listener: "b", adopted: true };
  expect(await evaluateBooleanMatch(order, [{ type: "heard", listener: "a", adopted: false }, moved])).toMatchObject({ state: "mismatched" });
  expect(await evaluateBooleanMatch(order, [{ type: "heard", listener: "b", adopted: false }, moved])).toMatchObject({ state: "matched" });
});

test("unknown steps permit only reachable chains, with known competing witnesses taking priority", async () => {
  const uncertain = defineValueMatch<number>({ name: "uncertain-one", evaluate: value => value === 0
    ? { state: "unavailable", reason: "uncertain-step" } : value === 1 });
  const order = inOrder([uncertain, equals(2)]);
  expect(await evaluateBooleanMatch(order, [0, 2])).toMatchObject({ state: "unavailable", reason: "uncertain-step" });
  expect(await evaluateBooleanMatch(order, [0, 3])).toMatchObject({ state: "mismatched" });
  expect(await evaluateBooleanMatch(order, [0, 1, 2])).toMatchObject({ state: "matched" });
  expect(await evaluateBooleanMatch(order, [2, 0])).toMatchObject({ state: "mismatched" });
});

test("partial and unavailable sequences never evaluate any step", async () => {
  const step = defineValueMatch<number>({ name: "must-not-run", evaluate: () => { throw new Error("Incomplete collection evaluated a step"); } });
  for (const subject of [
    { state: "partial", items: [{ id: "one", value: 1 }, { id: "two", value: 2 }], reason: "not-sealed" },
    { state: "unavailable", reason: "not-sealed" },
  ] as const) {
    expect(await evaluateBooleanMatch(inOrder([step, step]), subject)).toMatchObject({ state: "unavailable", reason: "not-sealed" });
  }
});

test("sequence diagnostics retain original indices, material IDs, steps and child diagnostics", async () => {
  const subject = { state: "complete", items: [
    { id: "heard", value: 1 }, { id: "unrelated", value: 0 }, { id: "adopted-movement", value: 2 },
  ] } as const;
  const result = await evaluateBooleanMatch(inOrder([equals(1), equals(2)]), subject);
  expect(result).toMatchObject({ state: "matched", diagnostic: { children: [
    { index: 0, label: "heard", state: "matched", diagnostic: { path: ["items", 0], children: [{ index: 0, state: "matched" }] } },
    { index: 1, label: "unrelated", state: "mismatched", diagnostic: { path: ["items", 1], children: [{ index: 1, state: "mismatched", diagnostic: { code: "equals-mismatch" } }] } },
    { index: 2, label: "adopted-movement", state: "matched", diagnostic: { path: ["items", 2], children: [{ index: 1, state: "matched" }] } },
  ] } });
  if (result.state === "matched") expect(result.value).toBe(subject);
});

test("each relevant item-step pair is evaluated once and exceptions escape unchanged", async () => {
  const evaluated = new Set<string>();
  const steps = [1, 2, 3].map(step => defineValueMatch<number>({ name: `step-${step}`, evaluate: value => {
    const key = `${value}/${step}`;
    expect(evaluated.has(key), key).toBe(false);
    evaluated.add(key);
    return value === step;
  } }));
  expect(await evaluateBooleanMatch(inOrder([steps[0], steps[1], steps[2]]), [1, 4, 2, 5, 3])).toMatchObject({ state: "matched" });
  const defect = new Error("sequence step defect");
  const broken = defineValueMatch<number>({ name: "broken", evaluate: () => { throw defect; } });
  await expect(evaluateBooleanMatch(inOrder([equals(1), broken]), [1, 2])).rejects.toBe(defect);
  // Unknown candidates bypass even a permissive/throwing step.
  const missing = new Array<number>(2);
  expect(await evaluateBooleanMatch(inOrder([broken, broken]), missing)).toMatchObject({ state: "unavailable" });
});

test("sequence factories enforce managed homogeneous Boolean steps and the 2–64 bound", async () => {
  const raw = { kind: "boolean", domain: "value", name: "forged" } as unknown as BooleanMatch<unknown, unknown>;
  const values = [equals(1), equals(2)] as const;
  const score = defineScoreMatch<number>({ name: "score", score: () => 1 });
  const ctx = defineContextMatch<unknown, number>({ name: "ctx", read: () => ({ state: "available", value: 1 }), match: equals(1) });
  for (const invalid of [raw, { ...values[0] }, score, ctx, toolMatch("tool"), eventMatch("message")]) {
    expect(() => inOrder([values[0], invalid as unknown as BooleanMatch<unknown, unknown>])).toThrow();
    expect(() => inOrder([invalid as unknown as BooleanMatch<unknown, unknown>, values[0]])).toThrow();
  }
  // @ts-expect-error Runtime construction also validates a missing second step.
  expect(() => inOrder([equals(1)])).toThrow("at least two");
  const sparseSteps = [equals(1), equals(2)] as [BooleanMatch<unknown, unknown>, BooleanMatch<unknown, unknown>];
  Reflect.deleteProperty(sparseSteps, 1);
  expect(() => inOrder(sparseSteps)).toThrow("created by niceeval/expect");
  const sixtyFour = [equals(1), equals(1), ...Array.from({ length: 62 }, () => equals(1))] as const;
  expect(await evaluateBooleanMatch(inOrder(sixtyFour), new Array<number>(64).fill(1))).toMatchObject({ state: "matched" });
  expect(await evaluateBooleanMatch(inOrder(sixtyFour), new Array<number>(63).fill(1))).toMatchObject({ state: "mismatched" });
  expect(() => inOrder([...sixtyFour, equals(1)])).toThrow("at most 64");
});
