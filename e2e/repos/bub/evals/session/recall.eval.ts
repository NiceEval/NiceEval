import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";

// 会话由 Adapter 管理(ctx.session.id / ctx.session.capture,见 src/agents/bub.ts):第二轮
// t.send() 复用同一个 session_id 续接同一个 tape 文件,第二轮能引用首轮事实
// (docs/engineering/e2e-ci/adapters/bub.md「会话」)。
export default defineEval({
  description: "session is adapter-managed: second turn recalls a fact established in the first",

  async test(t) {
    const first = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}My favorite number is 47. Just acknowledge that you'll remember it — ` +
        `don't write any files.`,
    );
    first.expectOk();
    first.maxTokens(50_000);

    const recall = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}What is my favorite number? Answer with just the number.`,
    );
    recall.expectOk();
    t.check(recall.message, includes("47"));
    recall.maxTokens(50_000);
  },
});
