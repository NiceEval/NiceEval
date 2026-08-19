// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-sandbox

import { defineEval } from "niceeval";

export default defineEval({
  description: "高基数及大文本 workspace 变化按 File Changes 上限形成可发布的 partial 证据",
  async test(t) {
    const turn = await t.send("workspace/diff-cap");
    turn.succeeded().label("bulk workspace edit completed");
  },
});
