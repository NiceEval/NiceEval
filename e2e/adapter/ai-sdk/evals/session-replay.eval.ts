// Protocol behavior: 会话 — the UI Message Stream protocol is server-stateless and
// client-full-history: the adapter stores the whole UIMessage[] history and replays it
// every turn (an Adapter-private typed session slot), so a second turn on the same session line can
// recall the first turn's fact. A fresh session line shares none of that history.
import { defineEval } from "niceeval";
import { excludes } from "niceeval/expect";

export default defineEval({
  description: "全量历史重放让第二轮能记起第一轮的事实;全新会话则完全不共享",
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
