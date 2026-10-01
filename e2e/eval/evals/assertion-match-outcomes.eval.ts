import { defineScoreEval } from "niceeval";
import {
  and,
  commandMatch,
  commandSucceeded,
  countWhere,
  filterWhere,
  mapEach,
  mapValue,
  defineScoreMatch,
  defineValueMatch,
  equals,
  eventMatch,
  excludes,
  hasSections,
  includes,
  includesUrl,
  inOrder,
  isDefined,
  isFalse,
  isTrue,
  jsonMatch,
  matches,
  not,
  or,
  pattern,
  referencesAnyPath,
  satisfies,
  similarity,
  toolMatch,
} from "niceeval/expect";

const fixtureSchema = {
  "~standard": {
    version: 1,
    vendor: "niceeval-e2e",
    validate(value: unknown) {
      return value === "schema-ok"
        ? { value }
        : { issues: [{ message: "expected schema-ok" }] };
    },
  },
} as const;

export default defineScoreEval({
  description: "每个公开 Match factory 在真实 Eval 中发布 matched 与 mismatched 结果",
  async test(t) {
    const turn = await t.send("assertion/match-outcomes");
    await turn.succeeded().orStop();

    t.check([0, 1, 0, 0], countWhere(equals(0), equals(3))).score(1).label("countWhere:matched");
    t.check([0, 1], countWhere(equals(0), equals(3))).score(1).label("countWhere:mismatched");
    t.check([], countWhere(equals(0), equals(0))).label("countWhere.empty:matched");
    const actors = { state: "complete" as const, items: [
      { id: "actor-a", value: { id: "a", hp: 0 } },
      { id: "actor-b", value: { id: "b", hp: 10 } },
      { id: "actor-c", value: { id: "a", hp: 0 } },
    ] };
    const selected = defineValueMatch<{ readonly id: string; readonly hp: number }>({ name: "actor-a", evaluate: actor => actor.id === "a" });
    t.check(actors, filterWhere(selected, mapEach(actor => actor.hp, countWhere(equals(0), equals(2))))).score(1).label("filterWhere.mapEach:matched");
    t.check(actors, filterWhere(selected, mapEach(actor => actor.hp, countWhere(equals(0), equals(3))))).score(1).label("filterWhere.mapEach:mismatched");
    t.check({ actors }, mapValue("actors at end", value => value.actors, countWhere(selected, equals(2)))).score(1).label("mapValue:matched");
    t.check({ actors }, mapValue("actors at end", value => value.actors, countWhere(selected, equals(1)))).score(1).label("mapValue:mismatched");
    t.check([NaN], countWhere(equals(0), equals(0))).label("countWhere.nan:unavailable");
    t.check({ state: "partial" as const, reason: "actors-not-sealed", items: actors.items }, countWhere(selected, equals(2))).label("countWhere.partial:unavailable");
    const uncertain = defineValueMatch<number>({ name: "unknown-item", evaluate: () => ({ state: "unavailable", reason: "missing-hp" }) });
    t.check([0], countWhere(uncertain, equals(0))).label("countWhere.item:unavailable");
    t.check([0], filterWhere(uncertain, countWhere(equals(0), equals(0)))).label("filterWhere.item:unavailable");
    t.check([1], mapEach((_item: number) => NaN, countWhere(equals(0), equals(0)))).label("mapEach.nan:unavailable");
    t.check({ hp: NaN }, mapValue("hp", value => value.hp, equals(0))).label("mapValue.nan:unavailable");

    const sequence = inOrder([equals(1), equals(2)]);
    t.check([1, 2], sequence).label("inOrder.adjacent:matched");
    t.check([1, 0, 2], sequence).label("inOrder.subsequence:matched");
    t.check([2, 1], sequence).label("inOrder.reverse:mismatched");
    t.check([], sequence).label("inOrder.empty:mismatched");
    t.check([1], inOrder([equals(1), equals(1)])).label("inOrder.single-item:mismatched");
    t.check([1, 1], inOrder([equals(1), equals(1)])).label("inOrder.distinct-items:matched");
    t.check([undefined, 1, 2], sequence).label("inOrder.known-witness:matched");
    t.check([undefined, 2], sequence).label("inOrder.possible:unavailable");
    t.check([undefined, 0], sequence).label("inOrder.impossible:mismatched");
    t.check([NaN, 2], sequence).label("inOrder.nonfinite:unavailable");
    t.check([null, 2], sequence).label("inOrder.null:unavailable");
    const sparse = new Array<number>(2);
    sparse[1] = 2;
    t.check(sparse, sequence).label("inOrder.hole:unavailable");
    t.check([3, 0, 4], or(inOrder([equals(1), equals(2)]), inOrder([equals(3), equals(4)]))).label("inOrder.alternatives:matched");
    t.check([2, 1], not(inOrder([equals(1), equals(2)]))).label("inOrder.not:matched");
    t.check([1, 2], not(inOrder([equals(1), equals(2)]))).label("inOrder.not:mismatched");
    t.check([undefined, 2], not(inOrder([equals(1), equals(2)]))).label("inOrder.not:unavailable");
    const uncertainFirst = defineValueMatch<number>({ name: "uncertain-first", evaluate: value => value === 0
      ? { state: "unavailable", reason: "heard-not-verified" } : value === 1 });
    t.check([0, 2], inOrder([uncertainFirst, equals(2)])).label("inOrder.step:unavailable");
    t.check([0, 1, 2], inOrder([uncertainFirst, equals(2)])).label("inOrder.step-known-witness:matched");
    const forbiddenStep = defineValueMatch<unknown>({ name: "incomplete-step-must-not-run", evaluate: () => { throw new Error("Incomplete order evaluated a child"); } });
    t.check({ state: "partial" as const, reason: "events-not-sealed", items: [{ id: "one", value: 1 }, { id: "two", value: 2 }] }, inOrder([forbiddenStep, forbiddenStep])).label("inOrder.partial:unavailable");
    t.check({ state: "unavailable" as const, reason: "events-not-sealed" }, inOrder([forbiddenStep, forbiddenStep])).label("inOrder.source:unavailable");
    type GameEvent = { readonly type: "heard" | "movement"; readonly listener: string; readonly adopted: boolean };
    const heard = defineValueMatch<GameEvent>({ name: "heard-by-b", evaluate: event => event.type === "heard" && event.listener === "b" });
    const adoptedMovement = defineValueMatch<GameEvent>({ name: "adopted-movement", evaluate: event => event.type === "movement" && event.adopted });
    const gameEvents = { state: "complete" as const, items: [
      { id: "formally-heard", value: { type: "heard" as const, listener: "b", adopted: false } },
      { id: "unrelated-movement", value: { type: "movement" as const, listener: "b", adopted: false } },
      { id: "adopted-movement", value: { type: "movement" as const, listener: "b", adopted: true } },
    ] };
    t.check(gameEvents, inOrder([heard, adoptedMovement])).label("inOrder.heard-movement:matched");
    t.check({ state: "complete" as const, items: [...gameEvents.items].reverse() }, inOrder([heard, adoptedMovement])).label("inOrder.heard-movement:mismatched");

    t.check("alpha", includes("alpha"))
      .score(1)
      .label("includes:matched");
    t.check("alpha", includes("beta"))
      .score(1)
      .label("includes:mismatched");
    t.check("alpha", excludes("beta"))
      .score(1)
      .label("excludes:matched");
    t.check("alpha", excludes("alpha"))
      .score(1)
      .label("excludes:mismatched");
    t.check("alpha", pattern(/^alpha$/u))
      .score(1)
      .label("pattern:matched");
    t.check("alpha", pattern(/^beta$/u))
      .score(1)
      .label("pattern:mismatched");
    t.check("https://one.example", includesUrl(1))
      .score(1)
      .label("includesUrl:matched");
    t.check("plain text", includesUrl(1))
      .score(1)
      .label("includesUrl:mismatched");
    t.check("# One\n## Two", hasSections(2))
      .score(1)
      .label("hasSections:matched");
    t.check("# One", hasSections(2))
      .score(1)
      .label("hasSections:mismatched");
    t.check("value", isDefined())
      .score(1)
      .label("isDefined:matched");
    t.check(undefined, isDefined())
      .score(1)
      .label("isDefined:mismatched");
    t.check(true, isTrue())
      .score(1)
      .label("isTrue:matched");
    t.check(false, isTrue())
      .score(1)
      .label("isTrue:mismatched");
    t.check(false, isFalse())
      .score(1)
      .label("isFalse:matched");
    t.check(true, isFalse())
      .score(1)
      .label("isFalse:mismatched");
    t.check({ value: 1 }, equals({ value: 1 }))
      .score(1)
      .label("equals:matched");
    t.check({ value: 1 }, equals({ value: 2 }))
      .score(1)
      .label("equals:mismatched");
    t.check("schema-ok", matches(fixtureSchema))
      .score(1)
      .label("matches:matched");
    t.check("schema-bad", matches(fixtureSchema))
      .score(1)
      .label("matches:mismatched");
    t.check(2, satisfies("positive", (value: number) => value > 0))
      .score(1)
      .label("satisfies:matched");
    t.check(-1, satisfies("positive", (value: number) => value > 0))
      .score(1)
      .label("satisfies:mismatched");
    const custom = defineValueMatch<string>({ name: "custom", evaluate: (value) => value === "custom-ok" });
    t.check("custom-ok", custom)
      .score(1)
      .label("defineValueMatch:matched");
    t.check("custom-bad", custom)
      .score(1)
      .label("defineValueMatch:mismatched");
    t.check({ value: "json-ok" }, jsonMatch({ value: "json-ok" }))
      .score(1)
      .label("jsonMatch:matched");
    t.check({ value: "json-bad" }, jsonMatch({ value: "json-ok" }))
      .score(1)
      .label("jsonMatch:mismatched");
    const pathMatch = referencesAnyPath(["match/input.txt"]);
    t.check({ path: "match/input.txt" }, pathMatch)
      .score(1)
      .label("referencesAnyPath:matched");
    t.check({ path: "other.txt" }, pathMatch)
      .score(1)
      .label("referencesAnyPath:mismatched");
    t.check("alpha", and(includes("alpha"), excludes("beta")))
      .score(1)
      .label("and:matched");
    t.check("alpha", and(includes("alpha"), includes("beta")))
      .score(1)
      .label("and:mismatched");
    t.check("alpha", or(includes("beta"), includes("alpha")))
      .score(1)
      .label("or:matched");
    t.check("alpha", or(includes("beta"), includes("gamma")))
      .score(1)
      .label("or:mismatched");
    t.check("alpha", not(includes("beta")))
      .score(1)
      .label("not:matched");
    t.check("alpha", not(includes("alpha")))
      .score(1)
      .label("not:mismatched");
    t.check("same", similarity("same")).gate(1)
      .score(1)
      .label("similarity:matched");
    t.check("different", similarity("same")).gate(1)
      .score(1)
      .label("similarity:mismatched");
    const customScore = defineScoreMatch<string>({ name: "custom score", score: (value) => value === "score-ok" ? 1 : 0 });
    t.check("score-ok", customScore).gate(1)
      .score(1)
      .label("defineScoreMatch:matched");
    t.check("score-bad", customScore).gate(1)
      .score(1)
      .label("defineScoreMatch:mismatched");
    t.check({ exitCode: 0 }, commandSucceeded())
      .score(1)
      .label("commandSucceeded:matched");
    t.check({ exitCode: 1 }, commandSucceeded())
      .score(1)
      .label("commandSucceeded:mismatched");

    turn.calledTool(toolMatch("matcher_tool"))
      .score(1)
      .label("toolMatch.name:matched");
    turn.calledTool(toolMatch("missing_tool"))
      .score(1)
      .label("toolMatch.name:mismatched");
    turn.calledTool(toolMatch("matcher_tool", {
      input: jsonMatch({ path: "match/input.txt" }),
    }))
      .score(1)
      .label("toolMatch.input:matched");
    turn.calledTool(toolMatch("matcher_tool", {
      input: jsonMatch({ path: "other.txt" }),
    }))
      .score(1)
      .label("toolMatch.input:mismatched");
    turn.calledTool(toolMatch("matcher_tool", {
      output: jsonMatch({ marker: "match-output" }),
    }))
      .score(1)
      .label("toolMatch.output:matched");
    turn.calledTool(toolMatch("matcher_tool", {
      output: jsonMatch({ marker: "other-output" }),
    }))
      .score(1)
      .label("toolMatch.output:mismatched");
    turn.calledTool(toolMatch("matcher_tool", { status: "completed" }))
      .score(1)
      .label("toolMatch.status:matched");
    turn.calledTool(toolMatch("matcher_tool", { status: "failed" }))
      .score(1)
      .label("toolMatch.status:mismatched");
    turn.calledTool(toolMatch("matcher_tool", {
      input: referencesAnyPath(["match/input.txt"]),
    }))
      .score(1)
      .label("toolMatch.path:matched");
    turn.calledTool(toolMatch("matcher_tool", {
      input: referencesAnyPath(["other.txt"]),
    }))
      .score(1)
      .label("toolMatch.path:mismatched");
    turn.calledTool(toolMatch("matcher_tool", {
      input: referencesAnyPath(["match/input.txt"]),
    }))
      .score(1)
      .label("toolMatch.input-only:matched");
    turn.calledTool(toolMatch("matcher_tool", {
      input: referencesAnyPath(["other.txt"]),
    }))
      .score(1)
      .label("toolMatch.input-only:mismatched");
    turn.check(turn.toolCalls, toolMatch("matcher_tool").exactly(1))
      .score(1)
      .label("toolOccurrence.exact:matched");
    turn.check(turn.toolCalls, toolMatch("matcher_tool").exactly(2))
      .score(1)
      .label("toolOccurrence.exact:mismatched");
    turn.check(turn.toolCalls, toolMatch("matcher_tool").atLeast(1))
      .score(1)
      .label("toolOccurrence.atLeast:matched");
    turn.check(turn.toolCalls, toolMatch("matcher_tool").atLeast(2))
      .score(1)
      .label("toolOccurrence.atLeast:mismatched");
    turn.notCalledTool("missing_tool")
      .score(1)
      .label("notCalledTool:matched");
    turn.notCalledTool("matcher_tool")
      .score(1)
      .label("notCalledTool:mismatched");

    turn.calledTool(commandMatch("niceeval", {
      argsStart: ["exp"], excludes: ["--dry"], status: "completed",
    }))
      .score(1)
      .label("commandMatch:matched");
    turn.calledTool(commandMatch("missing"))
      .score(1)
      .label("commandMatch.executable:mismatched");
    turn.calledTool(commandMatch("niceeval", { argsStart: ["query"] }))
      .score(1)
      .label("commandMatch.argsStart:mismatched");
    turn.calledTool(commandMatch("niceeval", { excludes: ["fixture"] }))
      .score(1)
      .label("commandMatch.excludes:mismatched");
    turn.calledTool(commandMatch("niceeval", { status: "failed" }))
      .score(1)
      .label("commandMatch.status:mismatched");

    const message = eventMatch("message", { role: "assistant", text: includes("match-outcomes-marker") });
    t.check(
      turn.events,
      satisfies(
        "raw events remain an ordinary Value subject",
        (events) => events.some((event) => event.type === "message"),
      ),
    ).score(1).label("events.raw-value:matched");
    turn.check(turn.eventOccurrences, message.atLeast(1))
      .score(1)
      .label("eventOccurrence.atLeast:matched");
    turn.check(turn.eventOccurrences, message.exactly(1))
      .score(1)
      .label("eventOccurrence.exactly:matched");
    turn.check(turn.eventOccurrences, message.greaterThan(0))
      .score(1)
      .label("eventOccurrence.greaterThan:matched");
    turn.check(turn.eventOccurrences, message.atMost(1))
      .score(1)
      .label("eventOccurrence.atMost:matched");
    turn.check(turn.eventOccurrences, message.lessThan(2))
      .score(1)
      .label("eventOccurrence.lessThan:matched");
    turn.event(message)
      .score(1)
      .label("eventMatch:matched");
    turn.event(eventMatch("message", {
      role: "user",
      text: includes("missing-event-marker"),
    }))
      .score(1)
      .label("eventMatch:mismatched");
    turn.event(eventMatch("operation.started", {
      tool: toolMatch("matcher_tool"),
    }))
      .score(1)
      .label("eventMatch.tool:matched");
    turn.event(eventMatch("operation.started", {
      tool: toolMatch("missing_tool"),
    }))
      .score(1)
      .label("eventMatch.tool:mismatched");
    turn.event(eventMatch("operation.finished", {
      tool: toolMatch("matcher_tool"),
    }))
      .score(1)
      .label("eventMatch.finished:matched");
    turn.event(eventMatch("operation.finished", {
      tool: toolMatch("missing_tool"),
    }))
      .score(1)
      .label("eventMatch.finished:mismatched");
    turn.eventOrder([
      eventMatch("operation.started", { tool: toolMatch("matcher_tool") }),
      eventMatch("operation.finished", { tool: toolMatch("matcher_tool") }),
      eventMatch("message"),
    ])
      .score(1)
      .label("eventOrder:matched");
    turn.eventOrder([
      eventMatch("message", { role: "assistant" }),
      eventMatch("operation.started", { tool: toolMatch("matcher_tool") }),
    ])
      .score(1)
      .label("eventOrder:mismatched");
  },
});
