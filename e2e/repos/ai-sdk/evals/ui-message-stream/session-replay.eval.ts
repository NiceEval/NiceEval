// Protocol behavior: 会话 — the UI Message Stream protocol is server-stateless and
// client-full-history: the adapter stores the whole UIMessage[] history and replays it
// every turn (ctx.session.history()), so a second turn on the same session line can
// recall the first turn's fact. A fresh session line shares none of that history.
import { defineEval } from "niceeval";
import { excludes } from "niceeval/expect";

export default defineEval({
  description: "full-history replay lets turn two recall turn one's fact; a fresh session shares none of it",
  async test(t) {
    (await t.send("我叫小明，帮我记住这个名字。")).expectOk();
    const recall = await t.send("我刚才说我叫什么名字？");
    recall.expectOk();
    recall.messageIncludes("小明");

    // The reverse half only means something once we've proven this turn actually ran —
    // an errored fresh turn would return an empty reply, against which excludes() is
    // vacuously true and would make "isolation held" a hollow conclusion.
    const fresh = t.newSession();
    const freshTurn = await fresh.send("我叫什么名字？");
    freshTurn.expectOk();
    t.check(fresh.reply, excludes("小明"));
  },
});
