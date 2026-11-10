// Type-only consumer contracts, checked by package typecheck.
import { expectTypeOf } from "vitest";
import type { AssertionCheck, BooleanAssertionHandle, MeasurementAssertionHandle } from "./api.ts";
import type { ContextBooleanMatch, ContextScoreMatch, MaterialMatch } from "./context-match.ts";
import { equals } from "./match.ts";
import type { AgentMatchContext, AssertFirstTestContext, AssertFirstSessionHandle, AssertFirstTurnHandle } from "../context/assert-first.ts";

// @feature docs/feature/assertions/README.md
function contextualCheckTypes(
  check: AssertionCheck<"score", { readonly count: number }>,
  boolean: ContextBooleanMatch<{ readonly count: number }, number>,
  material: MaterialMatch<{ readonly count: number }, string>,
  score: ContextScoreMatch<{ readonly count: number }, string>,
  union: typeof boolean | typeof material | typeof score,
) {
  expectTypeOf(check(boolean)).toEqualTypeOf<BooleanAssertionHandle<"score", void>>();
  expectTypeOf(check(material)).toEqualTypeOf<BooleanAssertionHandle<"score", void>>();
  expectTypeOf(check(score)).toEqualTypeOf<MeasurementAssertionHandle<"score">>();
  expectTypeOf(check(union)).toEqualTypeOf<BooleanAssertionHandle<"score", void> | MeasurementAssertionHandle<"score">>();
  expectTypeOf(check(1, equals(1)).orStop()).toEqualTypeOf<Promise<1>>();
  // @ts-expect-error Context is supplied by the receiver, not an explicit subject.
  check({ count: 1 }, boolean);
  // @ts-expect-error A value Match still needs an explicit subject.
  check(equals(1));
  // @ts-expect-error Contextual Matches do not accept a second argument.
  check(boolean, undefined);
  // @ts-expect-error A Match cannot read fields absent from the receiver.
  check({} as ContextBooleanMatch<{ readonly missing: string }, number>);
}

// @feature docs/feature/assertions/README.md
function agentScopeCheckTypes(
  t: AssertFirstTestContext<"pass">,
  session: AssertFirstSessionHandle<"pass">,
  turn: AssertFirstTurnHandle<"pass">,
  attemptMatch: ContextBooleanMatch<AgentMatchContext<"attempt">, number>,
  sessionMatch: MaterialMatch<AgentMatchContext<"session">, string>,
  turnMatch: ContextScoreMatch<AgentMatchContext<"turn">, number>,
) {
  expectTypeOf(t.check(attemptMatch)).toEqualTypeOf<BooleanAssertionHandle<"pass", void>>();
  expectTypeOf(session.check(sessionMatch)).toEqualTypeOf<BooleanAssertionHandle<"pass", void>>();
  expectTypeOf(turn.check(turnMatch)).toEqualTypeOf<MeasurementAssertionHandle<"pass">>();
  const { check } = turn;
  expectTypeOf(check(turnMatch)).toEqualTypeOf<MeasurementAssertionHandle<"pass">>();
  // @ts-expect-error Turn-only readers cannot inspect Attempt state.
  t.check(turnMatch);
  // @ts-expect-error Session-only readers cannot inspect Turn state.
  turn.check(sessionMatch);
  // @ts-expect-error Attempt-only readers cannot inspect Session state.
  session.check(attemptMatch);
}
