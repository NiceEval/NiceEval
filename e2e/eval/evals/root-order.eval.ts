import { defineEval } from "niceeval";
import { eventMatch, includes, jsonMatch, toolMatch } from "niceeval/expect";

const first = toolMatch("context_main", { input: jsonMatch({ turn: "first" }) });
const second = toolMatch("context_main", { input: jsonMatch({ turn: "second" }) });
const firstMessage = eventMatch("message", { text: includes("context-main-first") });
const secondMessage = eventMatch("message", { text: includes("context-main-second") });

export default defineEval({
  async test(t) {
    t.toolOrder([first, second]).label("empty");
    await t.send("context/main-first");
    t.toolOrder([first, second]).label("frozen before second");
    await t.send("context/main-second");
    t.toolOrder([first, second]).label("main across turns");
    t.eventOrder([firstMessage, secondMessage]).label("main events across turns");
    const branch = t.newSession();
    await branch.send("context/branch");
    t.toolOrder([second, toolMatch("context_branch")]).label("no cross session tools");
    t.eventOrder([secondMessage, eventMatch("message", { text: includes("context-branch-only") })]).label("no cross session events");
    const partial = t.newSession();
    await partial.send("assertion/scopes-branch");
    t.toolOrder([first, second]).label("matched beats unavailable");
    t.toolOrder([toolMatch("never"), toolMatch("never")]).label("unavailable beats mismatch");
  },
});
