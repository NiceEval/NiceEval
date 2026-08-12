import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";
import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";

// 会话由 Adapter 管理(ctx.session.id / ctx.session.capture,见 src/agents/bub.ts):第二轮
// t.send() 复用同一个 session_id 续接同一个 tape 文件,第二轮能引用首轮事实
// (docs/engineering/testing/e2e/adapter/bub.md「会话」)。
export default defineEval({
  description: "会话由 adapter 管理:第二轮能引用首轮建立的事实",

  async test(t) {
    const first = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}我最喜欢的数字是 47。只需确认你会记住它——` +
        `不要写任何文件。`,
    );
    await first.succeeded().orStop();
    t.check(
      first.usage,
      satisfies(
        "usage within 50_000 tokens",
        (usage) =>
          usage !== undefined &&
          (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) <= 50_000,
      ),
    );

    const recall = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}我最喜欢的数字是多少?只回答数字。`,
    );
    await recall.succeeded().orStop();
    t.check(recall.message, includes("47"));
    t.check(
      recall.usage,
      satisfies(
        "usage within 50_000 tokens",
        (usage) =>
          usage !== undefined &&
          (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) <= 50_000,
      ),
    );
  },
});
