import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

export default defineEval({
  description: "HITL 选项:AskUserQuestion 暂停后按 request ID 选择并恢复同一会话",
  async test(t) {
    const waiting = await t.send(
      "Use AskUserQuestion exactly once. Ask which runtime to use, with exactly two options whose labels are Node.js and Bun. After the answer, reply with selected:<label>. Do not choose on the user's behalf.",
    );
    t.check(waiting.status, equals("waiting"));
    const request = t.requireInputRequest({
      action: "AskUserQuestion",
      optionIds: ["Node.js", "Bun"],
    });

    const resumed = await t.respond({ request, optionId: "Node.js" });
    await resumed.succeeded().orStop();
    t.check(resumed.message, includes("selected:Node.js"));
  },
});
