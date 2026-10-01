import { defineScoreEval } from "niceeval";
import { eventMatch, isTrue, toolMatch } from "niceeval/expect";

function authoringRejected(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch (error) {
    if (error instanceof TypeError) return true;
    throw error;
  }
}

export default defineScoreEval({
  description: "Agent QA captures complete scoped history once and preserves public model audit",
  judge: "judge-eval-override",
  async test(t) {
    // No send has occurred: the complete empty history measures zero locally.
    t.closeQA("ACCEPT: empty attempt history").label("Agent QA empty");
    const main = t.newSession();
    const firstTurn = await main.send("context/main-first");
    firstTurn.closeQA("ACCEPT: first turn history").gate(1).score(1).label("Agent QA turn");
    main.closeQA("ACCEPT: main session before second send").gate(1).score(1).label("Agent QA session snapshot");

    await main.send("context/main-second");
    const branch = t.newSession();
    await branch.send("context/branch");
    await branch.send("context/branch");

    // Extracting the method must retain the original turn receiver after later sends.
    const { closeQA } = firstTurn;
    closeQA("ACCEPT: detached first turn history").gate(1).score(1).label("Agent QA detached turn");
    main.closeQA("ACCEPT: both main session turns").gate(1).score(1).label("Agent QA session");
    t.closeQA("ACCEPT: all main and branch history").gate(1).score(1).label("Agent QA attempt");
    t.closeQA(eventMatch("message", { role: "assistant" }), "ACCEPT: all assistant messages")
      .gate(1).score(1).label("Agent QA assistant events");
    t.closeQA(toolMatch("context_branch"), "ACCEPT: all branch tool calls")
      .gate(1).score(1).label("Agent QA branch tools");

    // Later material must not drift into any already registered QA capture.
    const valuesTurn = await main.send("assertion/values");
    valuesTurn.usedNoTools().gate().label("Agent QA no tools");
    t.check(authoringRejected(() => Reflect.apply(t.usedNoTools, t, [toolMatch("context_main")])), isTrue())
      .gate().label("Agent QA attempt rejects usedNoTools Match");
    main.check(authoringRejected(() => Reflect.apply(main.usedNoTools, main, [toolMatch("context_main")])), isTrue())
      .gate().label("Agent QA session rejects usedNoTools Match");
    valuesTurn.check(authoringRejected(() => Reflect.apply(valuesTurn.usedNoTools, valuesTurn, [toolMatch("context_main")])), isTrue())
      .gate().label("Agent QA turn rejects usedNoTools Match");
  },
});
