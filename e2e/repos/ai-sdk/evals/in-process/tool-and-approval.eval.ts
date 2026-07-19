// Protocol behavior: 进程内循环 — aiSdkAgent walks the same tool-call + approval
// vocabulary as the HTTP (ui-message-stream) transport, proving the two transports agree
// on event shape. This Eval also carries this repo's OTel proof (see agents/in-process.ts):
// the ungated get_weather call is what scripts/verify.ts correlates against `show
// --execution` / `--timing`, since it has fewer moving parts than the approval-gated call.
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "in-process aiSdkAgent: bare-name tool call + HITL approval, same vocabulary as the HTTP transport",
  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    turn.expectOk();
    await t.group("bare tool name call + result pairing", () => {
      t.calledTool("get_weather", { input: { city: /北京/ } });
      t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);
    });

    const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
    t.check(draft.status, equals("waiting"));
    t.requireInputRequest({ action: "calculate" });

    const approved = await t.respond("approve");
    approved.succeeded();
    t.calledTool("calculate", { status: "completed" });
    t.messageIncludes(/126/);
  },
});
