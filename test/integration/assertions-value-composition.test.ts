import { createRequire } from "node:module";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createFixtureProject,
  runSingleAttempt,
  selectInspectionOperation,
  withOperational,
  writeJson,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";
import { readAssertionsList } from "./fixtures/judge-harness/harness.ts";

import type { BooleanMatch, CollectionValue } from "../../packages/niceeval/src/expect/index.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const {
  countWhere,
  defineContextMatch,
  defineScoreMatch,
  equals,
  eventMatch,
  filterWhere,
  inOrder,
  mapEach,
  mapValue,
  toolMatch,
} = require("niceeval/expect") as typeof import("../../packages/niceeval/src/expect/index.ts");

const EVAL_FILES = {
  "adapters/eval-only.ts": `
    import { defineAdapter } from "niceeval";
    export const plainAdapter = defineAdapter({
      name: "value-composition",
      behaviorRevision: "1",
      create() {
        return {};
      },
    });
  `,
  "evals/ordered.eval.ts": `
    import { readFile } from "node:fs/promises";
    import { resolve } from "node:path";
    import { and, countWhere, defineValueMatch, equals, filterWhere, inOrder, mapEach, mapValue, not, or, satisfies } from "niceeval/expect";
    import { plainAdapter } from "../adapters/eval-only.ts";

    export default plainAdapter.defineEval({
      async test(t) {
        const plan = JSON.parse(await readFile(resolve(import.meta.dirname, "..", "plan.json"), "utf8"));
        const revive = (v) =>
          v === "@undef" ? undefined : v === "@nan" ? NaN : v === "@inf" ? Infinity : v === "@ninf" ? -Infinity : v;

        for (const [idx, item] of plan.orderCases.entries()) {
          const subject = item.subject.map(revive);
          t.check(subject, inOrder([equals(1), equals(2)])).label("order-" + idx);
        }

        // Literal predicates & projection refinement
        const counted = countWhere(equals(0), equals(3));
        t.check([0, 1, 0, 0], counted).label("count-matched");
        t.check({ kind: "npc", hp: [0, 1, 0, 0] }, mapValue("hp", (npc) => npc.hp, counted)).label("map-value-matched");

        // Incomplete MaterialCollection never invokes inner predicates, projections, or aggregates
        const shortCircuitCalls = [];
        const spyItem = defineValueMatch({ name: "item", evaluate: () => { shortCircuitCalls.push("item"); return true; } });
        const spyAgg = defineValueMatch({ name: "agg", evaluate: () => { shortCircuitCalls.push("agg"); return true; } });
        const spyCount = defineValueMatch({ name: "count", evaluate: () => { shortCircuitCalls.push("count"); return true; } });
        const spyProj = mapEach((v) => { shortCircuitCalls.push("proj"); return v; }, spyAgg);
        for (const state of ["partial", "unavailable"]) {
          const subject = state === "partial"
            ? { state, reason: "producer-incomplete", items: [{ id: "one", value: 1 }] }
            : { state, reason: "producer-incomplete" };
          t.check(subject, countWhere(spyItem, spyCount)).label("sc-count-" + state);
          t.check(subject, filterWhere(spyItem, spyAgg)).label("sc-filter-" + state);
          t.check(subject, spyProj).label("sc-map-" + state);
          t.check(subject, inOrder([spyItem, spyItem])).label("sc-order-" + state);
        }
        t.check(shortCircuitCalls, equals([])).label("short-circuit-zero-calls");

        // Unknown items & array holes in countWhere and inOrder
        const hole = new Array(1);
        const hole2 = new Array(2);
        hole2[1] = 2;
        const inherited = new Array(1);
        Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: 1 }));
        const inherited2 = new Array(2);
        inherited2[1] = 2;
        Object.setPrototypeOf(inherited2, Object.assign(Object.create(Array.prototype), { 0: 0 }));
        const countZero = countWhere(equals(0), equals(0));
        for (const [i, s] of [[undefined], [null], [NaN], [Infinity], [-Infinity], hole, inherited].entries()) {
          t.check(s, countZero).label("count-unknown-" + i);
        }
        t.check([], countZero).label("count-empty");
        t.check(hole2, inOrder([equals(1), equals(2)])).label("order-hole");
        t.check(inherited2, inOrder([equals(1), equals(2)])).label("order-inherited");

        // Unknown selector prevents filterWhere from presenting a complete subset
        let filterAggCalls = 0;
        const uncertainSel = defineValueMatch({
          name: "selector",
          evaluate: (v) => (v === 2 ? { state: "unavailable", reason: "unknown-selector" } : v === 1),
        });
        const filterAgg = defineValueMatch({ name: "agg", evaluate: () => { filterAggCalls += 1; return true; } });
        t.check(
          { state: "complete", items: [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }] },
          filterWhere(uncertainSel, filterAgg),
        ).label("filter-unknown-selector");
        t.check(filterAggCalls, equals(0)).label("filter-unknown-agg-zero");

        // filterWhere and mapEach preserve material identity, source positions, and diagnostic children
        const first = { n: 1 }, last = { n: 3 };
        const completeColl = {
          state: "complete",
          items: [{ id: "first", value: first }, { id: "middle", value: { n: 2 } }, { id: "last", value: last }],
        };
        t.check(
          completeColl,
          filterWhere(
            satisfies("odd", (v) => v.n % 2 === 1),
            defineValueMatch({
              name: "subset",
              evaluate: (v) => v.state === "complete" && v.items.length === 2 && v.items[0].value === first && v.items[1].value === last,
            }),
          ),
        ).label("filter-identity");
        t.check(
          completeColl,
          mapEach(
            (v) => v.n,
            equals({ state: "complete", items: [{ id: "first", value: 1 }, { id: "middle", value: 2 }, { id: "last", value: 3 }] }),
          ),
        ).label("map-each-identity");

        // Non-finite / null / undefined projections never call permissive inner matches
        let innerCalls = 0;
        const innerPermissive = defineValueMatch({ name: "perm", evaluate: () => { innerCalls += 1; return true; } });
        for (const [i, bad] of [undefined, null, NaN, Infinity, -Infinity].entries()) {
          t.check(1, mapValue("proj", () => bad, innerPermissive)).label("bad-mapvalue-" + i);
          t.check([1], mapEach(() => bad, innerPermissive)).label("bad-mapeach-" + i);
        }
        t.check(innerCalls, equals(0)).label("bad-projection-inner-zero");

        // Distinct ordered steps, or/not, conjunction on same committed event, competing witnesses and memoization
        const repeated = inOrder([equals(1), equals(1)]);
        t.check([1], repeated).label("repeated-1");
        t.check([1, 1], repeated).label("repeated-2");
        t.check([3, 0, 4], or(inOrder([equals(1), equals(2)]), inOrder([equals(3), equals(4)]))).label("or-order-match");
        t.check([4, 3], or(inOrder([equals(1), equals(2)]), inOrder([equals(3), equals(4)]))).label("or-order-miss");
        t.check([1], not(repeated)).label("not-order-match");
        t.check([undefined, 1], not(repeated)).label("not-order-unavailable");

        const hearing = satisfies("hearing", (e) => e.type === "heard");
        const listener = satisfies("listener-b", (e) => e.listener === "b");
        const movement = satisfies("adopted-movement", (e) => e.type === "movement" && e.adopted);
        const evtOrder = inOrder([and(hearing, listener), movement]);
        const moved = { type: "movement", listener: "b", adopted: true };
        t.check([{ type: "heard", listener: "a", adopted: false }, moved], evtOrder).label("conj-miss");
        t.check([{ type: "heard", listener: "b", adopted: false }, moved], evtOrder).label("conj-match");

        const uncertainStep = defineValueMatch({
          name: "uncertain-one",
          evaluate: (v) => (v === 0 ? { state: "unavailable", reason: "uncertain-step" } : v === 1),
        });
        const compOrder = inOrder([uncertainStep, equals(2)]);
        t.check([0, 2], compOrder).label("witness-unavailable");
        t.check([0, 3], compOrder).label("witness-mismatched");
        t.check([0, 1, 2], compOrder).label("witness-matched");
        t.check([2, 0], compOrder).label("witness-reversed-mismatched");

        // Sequence diagnostics with material IDs
        t.check(
          { state: "complete", items: [{ id: "heard", value: 1 }, { id: "unrelated", value: 0 }, { id: "adopted-movement", value: 2 }] },
          inOrder([equals(1), equals(2)]),
        ).label("seq-diag");

        // Memoization: each (item, step) pair evaluated at most once
        const evaluated = new Set();
        let duplicateEvaluations = 0;
        const memoSteps = [1, 2, 3].map((step) =>
          defineValueMatch({
            name: "step-" + step,
            evaluate: (v) => {
              const key = v + "/" + step;
              if (evaluated.has(key)) duplicateEvaluations += 1;
              evaluated.add(key);
              return v === step;
            },
          }),
        );
        t.check([1, 4, 2, 5, 3], inOrder(memoSteps)).label("memo-match");
        t.check(duplicateEvaluations, equals(0)).label("memo-no-duplicates");

        // 64-step upper bound
        const sixtyFour = Array.from({ length: 64 }, () => equals(1));
        t.check(new Array(64).fill(1), inOrder(sixtyFour)).label("bound-64-match");
        t.check(new Array(63).fill(1), inOrder(sixtyFour)).label("bound-63-miss");
      },
    });
  `,
  "evals/errors.eval.ts": `
    import { readFile } from "node:fs/promises";
    import { resolve } from "node:path";
    import { countWhere, defineValueMatch, equals, filterWhere, inOrder, mapEach, mapValue } from "niceeval/expect";
    import { plainAdapter } from "../adapters/eval-only.ts";

    export default plainAdapter.defineEval({
      async test(t) {
        const { mode } = JSON.parse(await readFile(resolve(import.meta.dirname, "..", "error-mode.json"), "utf8"));
        const defect = new Error("projection defect");
        const broken = defineValueMatch({ name: "broken", evaluate: () => { throw defect; } });
        if (mode === "mapValue-throw") t.check(1, mapValue("throw", () => { throw defect; }, equals(0)));
        else if (mode === "mapEach-throw") t.check([1], mapEach(() => { throw defect; }, equals([])));
        else if (mode === "countWhere-throw") t.check([1], countWhere(broken, equals(0)));
        else if (mode === "filterWhere-throw") t.check([1], filterWhere(broken, equals([])));
        else if (mode === "mapValue-async") t.check(1, mapValue("async", () => Promise.resolve(1), equals(1)));
        else if (mode === "inOrder-throw") t.check([1, 2], inOrder([equals(1), broken]));
      },
    });
  `,
  "experiments/ordered.ts": `
    import { defineExperiment } from "niceeval";
    import { plainAdapter } from "../adapters/eval-only.ts";
    export default defineExperiment({ adapter: plainAdapter, evals: ["ordered"] });
  `,
  "experiments/errors.ts": `
    import { defineExperiment } from "niceeval";
    import { plainAdapter } from "../adapters/eval-only.ts";
    export default defineExperiment({ adapter: plainAdapter, evals: ["errors"] });
  `,
};

const ORDER_MATRIX = [
  { subject: [1, 2], state: "matched" },
  { subject: [1, 0, 2], state: "matched" },
  { subject: [2, 1], state: "mismatched" },
  { subject: [], state: "mismatched" },
  { subject: [1], state: "mismatched" },
  { subject: ["@undef", 1, 2], state: "matched" },
  { subject: [1, "@undef", 2], state: "matched" },
  { subject: ["@undef", 2], state: "unavailable" },
  { subject: [1, "@undef"], state: "unavailable" },
  { subject: ["@undef", 0], state: "mismatched" },
  { subject: [0, "@undef"], state: "mismatched" },
  { subject: ["@undef"], state: "mismatched" },
  { subject: ["@undef", "@undef"], state: "unavailable" },
  { subject: [null, 2], state: "unavailable" },
  { subject: ["@nan", 2], state: "unavailable" },
  { subject: ["@inf", 2], state: "unavailable" },
  { subject: ["@ninf", 2], state: "unavailable" },
] as const;

const ERROR_MODES = [
  "mapValue-throw",
  "mapEach-throw",
  "countWhere-throw",
  "filterWhere-throw",
  "mapValue-async",
  "inOrder-throw",
] as const;

describe("Value matcher composition and construction contracts", () => {
  let project: FixtureProject;
  let orderedLocator: string;
  const errorLocators = new Map<string, string>();

  beforeAll(async () => {
    project = await createFixtureProject("niceeval-value-comp", EVAL_FILES);
    await writeJson(project.cwd, "plan.json", { orderCases: ORDER_MATRIX });
    orderedLocator = await runSingleAttempt(project.cwd, "ordered");
    for (const mode of ERROR_MODES) {
      await writeJson(project.cwd, "error-mode.json", { mode });
      errorLocators.set(mode, await runSingleAttempt(project.cwd, "errors"));
    }
  }, 30_000);

  afterAll(async () => {
    await project?.dispose();
  });

  // @feature docs/feature/assertions/README.md#matcher-outcomes
  test("combinators require real Boolean steps in the same domain and accept long sequences", () => {
    const raw = { name: "raw", kind: "boolean", domain: "value" } as unknown as BooleanMatch<number, number>;
    const score = defineScoreMatch<number>({ name: "score", score: () => 1 });
    const ctx = defineContextMatch<unknown, number>({
      name: "ctx",
      read: () => ({ state: "available", value: 1 }),
      match: equals(1),
    });
    const badSteps = [
      raw,
      { ...equals(1) },
      score,
      ctx,
      toolMatch("tool"),
      eventMatch("message"),
    ];

    fc.assert(
      fc.property(fc.constantFrom(...badSteps), fc.boolean(), (invalid, firstPosition) => {
        expect(() => countWhere(raw, equals(0))).toThrow("created by niceeval/expect");
        expect(() => filterWhere(raw, equals([]))).toThrow("created by niceeval/expect");
        expect(() => mapValue("raw", (v: number) => v, raw)).toThrow("created by niceeval/expect");
        expect(() =>
          mapEach((v: number) => v, raw as unknown as BooleanMatch<CollectionValue<number>, CollectionValue<number>>),
        ).toThrow("created by niceeval/expect");
        expect(() =>
          mapValue("domain", (v: unknown) => v, toolMatch("tool") as unknown as BooleanMatch<unknown, unknown>),
        ).toThrow("value domain");
        expect(() => countWhere(score as unknown as BooleanMatch<number, number>, equals(0))).toThrow("BooleanMatch");

        const pair = firstPosition
          ? [invalid as unknown as BooleanMatch<unknown, unknown>, equals(1)]
          : [equals(1), invalid as unknown as BooleanMatch<unknown, unknown>];
        expect(() => inOrder(pair as [BooleanMatch<unknown, unknown>, BooleanMatch<unknown, unknown>])).toThrow();
      }),
      { numRuns: badSteps.length * 2 },
    );

    // @ts-expect-error Runtime construction also validates a missing second step.
    expect(() => inOrder([equals(1)])).toThrow("at least two");
    const sparseSteps = [equals(1), equals(2)] as [BooleanMatch<unknown, unknown>, BooleanMatch<unknown, unknown>];
    Reflect.deleteProperty(sparseSteps, 1);
    expect(() => inOrder(sparseSteps)).toThrow("created by niceeval/expect");
    const sixtyFive = Array.from({ length: 65 }, () => equals(1)) as [
      BooleanMatch<unknown, unknown>,
      BooleanMatch<unknown, unknown>,
      ...BooleanMatch<unknown, unknown>[],
    ];
    expect(() => inOrder(sixtyFive)).not.toThrow();
  });

  // @feature docs/feature/assertions/README.md#matcher-outcomes
  test("collection combinators and ordered steps satisfy three-valued semantics, short-circuiting, and diagnostics", async () => {
    const entries = await readAssertionsList(project.cwd, orderedLocator);
    const byLabel = new Map(
      entries.map((e) => {
        if (!("entry" in e)) throw new Error("Expected compact assertion entry");
        return [e.display.label, e] as const;
      }),
    );

    fc.assert(
      fc.property(fc.integer({ min: 0, max: ORDER_MATRIX.length - 1 }), (idx) => {
        const expected = ORDER_MATRIX[idx]!;
        expect(byLabel.get(`order-${idx}`)?.entry.decision.result).toBe(expected.state);
      }),
      { numRuns: ORDER_MATRIX.length },
    );

    expect(byLabel.get("count-matched")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("map-value-matched")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("short-circuit-zero-calls")?.entry.decision.result).toBe("matched");
    for (const state of ["partial", "unavailable"]) {
      expect(byLabel.get(`sc-count-${state}`)?.entry.decision.result).toBe("unavailable");
      expect(byLabel.get(`sc-filter-${state}`)?.entry.decision.result).toBe("unavailable");
      expect(byLabel.get(`sc-map-${state}`)?.entry.decision.result).toBe("unavailable");
      expect(byLabel.get(`sc-order-${state}`)?.entry.decision.result).toBe("unavailable");
    }

    for (let i = 0; i < 7; i += 1) {
      expect(byLabel.get(`count-unknown-${i}`)?.entry.decision.result).toBe("unavailable");
    }
    expect(byLabel.get("count-empty")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("order-hole")?.entry.decision.result).toBe("unavailable");
    expect(byLabel.get("order-inherited")?.entry.decision.result).toBe("unavailable");

    expect(byLabel.get("filter-unknown-selector")?.entry.decision.result).toBe("unavailable");
    expect(byLabel.get("filter-unknown-agg-zero")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("filter-identity")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("map-each-identity")?.entry.decision.result).toBe("matched");

    for (let i = 0; i < 5; i += 1) {
      expect(byLabel.get(`bad-mapvalue-${i}`)?.entry.decision.result).toBe("unavailable");
      expect(byLabel.get(`bad-mapeach-${i}`)?.entry.decision.result).toBe("unavailable");
    }
    expect(byLabel.get("bad-projection-inner-zero")?.entry.decision.result).toBe("matched");

    expect(byLabel.get("repeated-1")?.entry.decision.result).toBe("mismatched");
    expect(byLabel.get("repeated-2")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("or-order-match")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("or-order-miss")?.entry.decision.result).toBe("mismatched");
    expect(byLabel.get("not-order-match")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("not-order-unavailable")?.entry.decision.result).toBe("unavailable");
    expect(byLabel.get("conj-miss")?.entry.decision.result).toBe("mismatched");
    expect(byLabel.get("conj-match")?.entry.decision.result).toBe("matched");

    expect(byLabel.get("witness-unavailable")?.entry.decision.result).toBe("unavailable");
    expect(byLabel.get("witness-mismatched")?.entry.decision.result).toBe("mismatched");
    expect(byLabel.get("witness-matched")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("witness-reversed-mismatched")?.entry.decision.result).toBe("mismatched");

    expect(byLabel.get("memo-match")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("memo-no-duplicates")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("bound-64-match")?.entry.decision.result).toBe("matched");
    expect(byLabel.get("bound-63-miss")?.entry.decision.result).toBe("mismatched");

    await withOperational(project.cwd, (facts) => {
      const filterMeta = byLabel.get("filter-unknown-selector")!;
      const filterDetail = selectInspectionOperation(facts, {
        kind: "attempt.assertion.detail",
        locator: orderedLocator,
        entryId: filterMeta.entryId,
        projection: "full",
      }).assertion;
      expect(JSON.stringify(filterDetail)).toContain("unknown-selector");

      const seqMeta = byLabel.get("seq-diag")!;
      const seqDetail = selectInspectionOperation(facts, {
        kind: "attempt.assertion.detail",
        locator: orderedLocator,
        entryId: seqMeta.entryId,
        projection: "full",
      }).assertion;
      const serializedSeq = JSON.stringify(seqDetail);
      expect(serializedSeq).toContain("heard");
      expect(serializedSeq).toContain("unrelated");
      expect(serializedSeq).toContain("adopted-movement");
      expect(serializedSeq).toContain("composition-order-item");
      expect(serializedSeq).toContain("equals(value)");
      expect(serializedSeq).toContain("mismatched");
    });
  });

  // @feature docs/feature/assertions/README.md#matcher-outcomes
  test("projection and matcher exceptions surface as errored Attempts", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ERROR_MODES), async (mode) => {
        const errLocator = errorLocators.get(mode)!;
        await withOperational(project.cwd, (facts) => {
          const attempt = selectInspectionOperation(facts, { kind: "attempt.get", locator: errLocator }).attempt;
          expect(attempt.verdict, mode).toBe("errored");
        });
      }),
      { numRuns: ERROR_MODES.length },
    );
  });
});
