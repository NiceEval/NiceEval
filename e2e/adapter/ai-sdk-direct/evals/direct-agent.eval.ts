// owner: docs/engineering/testing/e2e/adapter/ai-sdk-direct.md#adapter-ai-sdk-direct-live-compatibility
//
// aiSdkAgent owns the in-process lifecycle around a real AI SDK generateText call:
// native tool evidence is normalized by turnFromAiSdk, the SDK response messages are
// retained as session history, and usage remains visible on the returned Turn.

import { defineEval } from "niceeval";
import { isDefined, satisfies, includes, toolMatch } from "niceeval/expect";

export const DIRECT_MARKER = "AI_SDK_DIRECT_E2E_7F31";

const positive = (label: string) =>
  satisfies(`${label} > 0`, (value) => typeof value === "number" && value > 0);

export default defineEval({
  description:
    "aiSdkAgent 用真实 generateText 保留工具配对、usage 与同会话历史",
  async test(t) {
    const first = await t.send(
      `请记住哨兵 ${DIRECT_MARKER}，并且必须调用 remember_marker 工具，marker 参数必须逐字等于这个哨兵。`,
    );
    await t.require(first.succeeded());
    t.assert(
      first.calledTool(
        toolMatch("remember_marker", {
          input: satisfies(
            '"remember_marker" input',
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              Object.is(input["marker"], DIRECT_MARKER),
          ),
          status: "completed",
        }),
        { count: 1 },
      ),
    );
    t.assert(
      t.check(first.usage?.inputTokens, positive("first.usage.inputTokens")),
    );
    t.assert(
      t.check(first.usage?.outputTokens, positive("first.usage.outputTokens")),
    );
    t.assert(t.check(t.sessionId, isDefined("aiSdkAgent 应捕获自己的会话 id")));

    const recall = await t.send(
      "只回复我上一轮要求你记住的哨兵，不要调用任何工具。",
    );
    await t.require(recall.succeeded());
    t.assert(t.check(recall.message, includes(DIRECT_MARKER)));
    t.assert(
      t.check(recall.usage?.inputTokens, positive("recall.usage.inputTokens")),
    );
    t.assert(
      t.check(
        recall.usage?.outputTokens,
        positive("recall.usage.outputTokens"),
      ),
    );
  },
});
