import { defineScoreEval } from "niceeval";
import { defineScoreMatch, includes, satisfies } from "niceeval/expect";

interface PreviewEvent {
  readonly type: string;
  readonly role?: string;
  readonly text?: string;
  readonly name?: string;
}

const eventGallery: readonly PreviewEvent[] = [
  { type: "message", role: "user", text: "Plan the offline preview response." },
  { type: "subagent.completed", name: "preview-reviewer" },
];

// Deterministic Score-kind result: Report owners use it to distinguish score
// evidence from pass verdicts without calling a provider.
export default defineScoreEval({
  description: "score:签入确定性计分结果",
  test(t) {
    t.check("Completed preview/state/score-complete.", includes("score-complete"))
      .score(3)
      .key("reply-marker")
      .label("Matched Boolean contribution");
    t.check("Completed preview/state/score-complete.", includes("never-present"))
      .score(5)
      .key("zero-contribution")
      .label("Mismatched Boolean contributes zero");
    t.check("Completed preview/state/score-complete.", defineScoreMatch({
      name: "rubric measurement",
      score: (value: string) => value.includes("score-complete") ? 0.75 : 0,
    })).atLeast(0.5).score(4).label("Measurement contributes three points");
    t.score(1).key("direct-score").label("Direct score contribution");
    t.check(
      eventGallery,
      satisfies("subagent lifecycle exists", (items: readonly PreviewEvent[]) =>
        items.some((event) => event.type === "subagent.completed")
      ),
    ).label("Subagent event is recorded");
  },
});
