import { Effect } from "effect";
import { defineAdapter } from "niceeval";
import { defineScoreMatch } from "niceeval/expect";

export const managedFailureApp = defineAdapter({
  name: "managed-failure-app",
  create: () => ({ output: () => "answer" }),
});
const recovering = defineScoreMatch<string>({
  name: "caught-provider-failure",
  version: "1",
  config: {},
  llm: {},
  score: (value, ctx) =>
    ctx.llm.classify({ rubric: "Assess the answer.", choices: ["accepted", "rejected"], material: value }).pipe(
      Effect.as(1),
      Effect.catch(() => Effect.succeed(1)),
    ),
});

export default managedFailureApp.defineScoreEval({
  test(t) {
    t.check(t.output(), recovering).score(10).label("Caught failure");
  },
});
