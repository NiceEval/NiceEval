import { defineEval } from "niceeval";

// deliberate-error 实验唯一的 eval:确定性执行错误(未捕获异常),验证 <error> 与 <failure>
// 判然有别(见 docs/engineering/e2e-ci/cli.md「退出码折叠」、verification.md 用例六)。
export default defineEval({
  description: "deliberate-error/crash:确定性执行错误(未捕获异常),不依赖远程调用是否成功",
  async test() {
    // 刻意不调用 t.send:errored 判定必须与远程网关是否可达无关,这里要的是一次纯粹的、
    // 与网络状态无关的执行错误(抛异常),不是评分失败——见 docs/feature/experiments/library.md
    // 「要让 attempt 进入 errored,抛出异常;要让 eval 判定失败,使用 t.check / t.require」。
    throw new Error("deliberate-error: intentional execution error for E2E exit-code contract verification");
  },
});
