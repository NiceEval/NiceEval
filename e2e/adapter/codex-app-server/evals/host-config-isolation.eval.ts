import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "宿主 Codex 配置与容器 Sandbox 隔离",
  async test(t) {
    const turn = await t.send("report the isolated host identity");
    await turn.succeeded().orStop();
    t.check(
      turn.message,
      includes('{"homeIdentity":"node","configPresent":true}'),
    );
  },
});
