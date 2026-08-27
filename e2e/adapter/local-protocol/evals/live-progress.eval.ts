// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#live-progress-owner
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

const USER_SENTINEL = "local-live-user-sentinel";

export default defineEval({
  description: "live-progress: TTY 在 UI Message Stream 完成前显示 user 与完整 tool input",
  async test(t) {
    const turn = await t.send(`${USER_SENTINEL}: send the deterministic live progress request`);
    await turn.succeeded().orStop();
    t.check(turn.message, includes("local-live-progress-complete"));
  },
});
