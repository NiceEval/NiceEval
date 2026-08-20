import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

export default defineEval({
  description:
    "HITL 选项正反对照:原生 AskUserQuestion 暂停后恢复，普通内容轮不会伪造待输入请求",
  async test(t) {
    const requestHitl = t.flags.requestHitl;
    if (requestHitl !== true && requestHitl !== false) {
      throw new TypeError("hitl-options Eval requires boolean flags.requestHitl");
    }

    const waiting = await t.send(
      requestHitl
        ? "Use AskUserQuestion exactly once. Ask which runtime to use, with exactly two options whose labels are Node.js and Bun. After the answer, reply with selected:<label>. Do not choose on the user's behalf."
        : 'Reply with exactly "ordinary-content". Do not call any tool.',
    );
    if (!requestHitl) {
      t.check(waiting.message, includes("ordinary-content"));
    }
    t.check(waiting.status, equals("waiting"));
    // 普通内容路径在上一行留下 failed assertion 后正常收口；不用
    // requireInputRequest() 把预期的 failed verdict 升级成 errored。
    if (waiting.status !== "waiting") return;

    const request = t.requireInputRequest({
      action: "AskUserQuestion",
      optionIds: ["Node.js", "Bun"],
    });

    const resumed = await t.respond({ request, optionId: "Node.js" });
    await resumed.succeeded().orStop();
    t.check(resumed.message, includes("selected:Node.js"));
  },
});
