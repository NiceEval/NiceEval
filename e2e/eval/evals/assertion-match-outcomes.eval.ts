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

interface ScorableAssertion {
  score(points: number): { label(value: string): unknown };
}

function outcome(label: string, assertion: ScorableAssertion): void {
  assertion.score(1).label(label);
}

export default defineScoreEval({
  description: "每个公开 Match factory 在真实 Eval 中发布 matched 与 mismatched 结果",
  async test(t) {
    const turn = await t.send("assertion/match-outcomes");
    await turn.succeeded().orStop();

    outcome("includes:matched", t.check("alpha", includes("alpha")));
    outcome("includes:mismatched", t.check("alpha", includes("beta")));
    outcome("excludes:matched", t.check("alpha", excludes("beta")));
    outcome("excludes:mismatched", t.check("alpha", excludes("alpha")));
    outcome("pattern:matched", t.check("alpha", pattern(/^alpha$/u)));
    outcome("pattern:mismatched", t.check("alpha", pattern(/^beta$/u)));
    outcome("includesUrl:matched", t.check("https://one.example", includesUrl(1)));
    outcome("includesUrl:mismatched", t.check("plain text", includesUrl(1)));
    outcome("hasSections:matched", t.check("# One\n## Two", hasSections(2)));
    outcome("hasSections:mismatched", t.check("# One", hasSections(2)));
    outcome("isDefined:matched", t.check("value", isDefined()));
    outcome("isDefined:mismatched", t.check(undefined, isDefined()));
    outcome("isTrue:matched", t.check(true, isTrue()));
    outcome("isTrue:mismatched", t.check(false, isTrue()));
    outcome("isFalse:matched", t.check(false, isFalse()));
    outcome("isFalse:mismatched", t.check(true, isFalse()));
    outcome("equals:matched", t.check({ value: 1 }, equals({ value: 1 })));
    outcome("equals:mismatched", t.check({ value: 1 }, equals({ value: 2 })));
    outcome("matches:matched", t.check("schema-ok", matches(fixtureSchema)));
    outcome("matches:mismatched", t.check("schema-bad", matches(fixtureSchema)));
    outcome("satisfies:matched", t.check(2, satisfies("positive", (value: number) => value > 0)));
    outcome("satisfies:mismatched", t.check(-1, satisfies("positive", (value: number) => value > 0)));
    const custom = defineValueMatch<string>({ name: "custom", evaluate: (value) => value === "custom-ok" });
    outcome("defineValueMatch:matched", t.check("custom-ok", custom));
    outcome("defineValueMatch:mismatched", t.check("custom-bad", custom));
    outcome("jsonMatch:matched", t.check({ value: "json-ok" }, jsonMatch({ value: "json-ok" })));
    outcome("jsonMatch:mismatched", t.check({ value: "json-bad" }, jsonMatch({ value: "json-ok" })));
    const pathMatch = referencesAnyPath(["match/input.txt"]);
    outcome("referencesAnyPath:matched", t.check({ path: "match/input.txt" }, pathMatch));
    outcome("referencesAnyPath:mismatched", t.check({ path: "other.txt" }, pathMatch));
    outcome("and:matched", t.check("alpha", and(includes("alpha"), excludes("beta"))));
    outcome("and:mismatched", t.check("alpha", and(includes("alpha"), includes("beta"))));
    outcome("or:matched", t.check("alpha", or(includes("beta"), includes("alpha"))));
    outcome("or:mismatched", t.check("alpha", or(includes("beta"), includes("gamma"))));
    outcome("not:matched", t.check("alpha", not(includes("beta"))));
    outcome("not:mismatched", t.check("alpha", not(includes("alpha"))));
    outcome("similarity:matched", t.check("same", similarity("same").atLeast(1)));
    outcome("similarity:mismatched", t.check("different", similarity("same").atLeast(1)));
    const customScore = defineScoreMatch<string>({ name: "custom score", score: (value) => value === "score-ok" ? 1 : 0 });
    outcome("defineScoreMatch:matched", t.check("score-ok", customScore.atLeast(1)));
    outcome("defineScoreMatch:mismatched", t.check("score-bad", customScore.atLeast(1)));
    outcome("commandSucceeded:matched", t.check({ exitCode: 0 }, commandSucceeded()));
    outcome("commandSucceeded:mismatched", t.check({ exitCode: 1 }, commandSucceeded()));

    outcome("toolMatch.name:matched", turn.calledTool(toolMatch("matcher_tool")));
    outcome("toolMatch.name:mismatched", turn.calledTool(toolMatch("missing_tool")));
    outcome("toolMatch.input:matched", turn.calledTool(toolMatch("matcher_tool", {
      input: jsonMatch({ path: "match/input.txt" }),
    })));
    outcome("toolMatch.input:mismatched", turn.calledTool(toolMatch("matcher_tool", {
      input: jsonMatch({ path: "other.txt" }),
    })));
    outcome("toolMatch.output:matched", turn.calledTool(toolMatch("matcher_tool", {
      output: jsonMatch({ marker: "match-output" }),
    })));
    outcome("toolMatch.output:mismatched", turn.calledTool(toolMatch("matcher_tool", {
      output: jsonMatch({ marker: "other-output" }),
    })));
    outcome("toolMatch.status:matched", turn.calledTool(toolMatch("matcher_tool", { status: "completed" })));
    outcome("toolMatch.status:mismatched", turn.calledTool(toolMatch("matcher_tool", { status: "failed" })));
    outcome("toolMatch.path:matched", turn.calledTool(toolMatch("matcher_tool", {
      input: referencesAnyPath(["match/input.txt"]),
    })));
    outcome("toolMatch.path:mismatched", turn.calledTool(toolMatch("matcher_tool", {
      input: referencesAnyPath(["other.txt"]),
    })));
    outcome("toolMatch.options:matched", turn.calledTool(toolMatch({
      input: referencesAnyPath(["match/input.txt"]),
    })));
    outcome("toolMatch.options:mismatched", turn.calledTool(toolMatch({
      input: referencesAnyPath(["other.txt"]),
    })));
    outcome("calledTool.count.exact:matched", turn.calledTool("matcher_tool", { count: 1 }));
    outcome("calledTool.count.exact:mismatched", turn.calledTool("matcher_tool", { count: 2 }));
    outcome("calledTool.count.atLeast:matched", turn.calledTool("matcher_tool", { count: { atLeast: 1 } }));
    outcome("calledTool.count.atLeast:mismatched", turn.calledTool("matcher_tool", { count: { atLeast: 2 } }));
    outcome("notCalledTool:matched", turn.notCalledTool("missing_tool"));
    outcome("notCalledTool:mismatched", turn.notCalledTool("matcher_tool"));

    outcome("commandMatch:matched", turn.calledTool(commandMatch("niceeval", {
      argsStart: ["exp"], excludes: ["--dry"], status: "completed",
    })));
    outcome("commandMatch.executable:mismatched", turn.calledTool(commandMatch("missing")));
    outcome("commandMatch.argsStart:mismatched", turn.calledTool(commandMatch("niceeval", { argsStart: ["show"] })));
    outcome("commandMatch.excludes:mismatched", turn.calledTool(commandMatch("niceeval", { excludes: ["fixture"] })));
    outcome("commandMatch.status:mismatched", turn.calledTool(commandMatch("niceeval", { status: "failed" })));

    const message = eventMatch("message", { role: "assistant", text: includes("match-outcomes-marker") });
    outcome("eventMatch:matched", turn.event(message));
    outcome("eventMatch:mismatched", turn.event(eventMatch("message", {
      role: "user",
      text: includes("missing-event-marker"),
    })));
    outcome("eventMatch.tool:matched", turn.event(eventMatch("operation.started", {
      tool: toolMatch("matcher_tool"),
    })));
    outcome("eventMatch.tool:mismatched", turn.event(eventMatch("operation.started", {
      tool: toolMatch("missing_tool"),
    })));
    outcome("eventMatch.finished:matched", turn.event(eventMatch("operation.finished", {
      tool: toolMatch("matcher_tool"),
    })));
    outcome("eventMatch.finished:mismatched", turn.event(eventMatch("operation.finished", {
      tool: toolMatch("missing_tool"),
    })));
    outcome("eventOrder:matched", turn.eventOrder([
      eventMatch("operation.started", { tool: toolMatch("matcher_tool") }),
      eventMatch("operation.finished", { tool: toolMatch("matcher_tool") }),
      eventMatch("message"),
    ]));
    outcome("eventOrder:mismatched", turn.eventOrder([
      eventMatch("message", { role: "assistant" }),
      eventMatch("operation.started", { tool: toolMatch("matcher_tool") }),
    ]));
  },
});
