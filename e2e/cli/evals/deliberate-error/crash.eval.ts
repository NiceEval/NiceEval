import { defineEval } from "niceeval";
import { sandboxLayer, shell } from "niceeval/sandbox";

const PRE_CONTEXT_ERROR = "deliberate pre-context sandbox prepare failure";

// deliberate-error 实验唯一的 eval:在 TestContext / Assertions runtime 建立前确定性失败，
// 验证这种执行错误仍会封成可发布、可 show 的 errored Attempt。
export default defineEval({
  description: "deliberate-error/crash:Sandbox prepare 阶段的确定性执行错误",
  sandbox: sandboxLayer().prepare(
    shell(`printf '%s\\n' '${PRE_CONTEXT_ERROR}' >&2; exit 17`),
  ),
  async test() {
    throw new Error("pre-context error fixture unexpectedly reached test(t)");
  },
});
