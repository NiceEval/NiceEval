import { defineScoreEval } from "niceeval";
import {
  and,
  commandMatch,
  commandSucceeded,
  defineScoreMatch,
  defineValueMatch,
  equals,
  eventMatch,
  excludes,
  hasSections,
  includes,
  includesUrl,
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
    t.check("same", similarity("same").atLeast(1))
      .score(1)
      .label("similarity:matched");
    t.check("different", similarity("same").atLeast(1))
      .score(1)
      .label("similarity:mismatched");
    const customScore = defineScoreMatch<string>({ name: "custom score", score: (value) => value === "score-ok" ? 1 : 0 });
    t.check("score-ok", customScore.atLeast(1))
      .score(1)
      .label("defineScoreMatch:matched");
    t.check("score-bad", customScore.atLeast(1))
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
    turn.calledTool(toolMatch({
      input: referencesAnyPath(["match/input.txt"]),
    }))
      .score(1)
      .label("toolMatch.options:matched");
    turn.calledTool(toolMatch({
      input: referencesAnyPath(["other.txt"]),
    }))
      .score(1)
      .label("toolMatch.options:mismatched");
    turn.calledTool("matcher_tool", { count: 1 })
      .score(1)
      .label("calledTool.count.exact:matched");
    turn.calledTool("matcher_tool", { count: 2 })
      .score(1)
      .label("calledTool.count.exact:mismatched");
    turn.calledTool("matcher_tool", { count: { atLeast: 1 } })
      .score(1)
      .label("calledTool.count.atLeast:matched");
    turn.calledTool("matcher_tool", { count: { atLeast: 2 } })
      .score(1)
      .label("calledTool.count.atLeast:mismatched");
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
    turn.calledTool(commandMatch("niceeval", { argsStart: ["show"] }))
      .score(1)
      .label("commandMatch.argsStart:mismatched");
    turn.calledTool(commandMatch("niceeval", { excludes: ["fixture"] }))
      .score(1)
      .label("commandMatch.excludes:mismatched");
    turn.calledTool(commandMatch("niceeval", { status: "failed" }))
      .score(1)
      .label("commandMatch.status:mismatched");

    const message = eventMatch("message", { role: "assistant", text: includes("match-outcomes-marker") });
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
