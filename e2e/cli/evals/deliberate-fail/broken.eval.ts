import { defineEval } from "niceeval";

// deliberate-fail 实验唯一的 eval:确定性 failed Turn + scope assertion,验证 CLI 退出码、
// JUnit <failure> 与 Human 失败原因展示(见 docs/engineering/testing/e2e/cli.md「退出码折叠」)。
export default defineEval({
  description: "deliberate-fail/broken:确定性 failed Turn 的 scope assertion",
  async test(t) {
    const turn = await t.send("return a failed turn");
    turn.succeeded();
  },
});
