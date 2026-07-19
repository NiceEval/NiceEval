import { defineEval } from "niceeval";
import { isTrue } from "niceeval/expect";

// deliberate-fail 实验唯一的 eval:确定性失败断言,验证 CLI 退出码折叠与 JUnit <failure>
// (见 docs/engineering/e2e-ci/cli.md「退出码折叠」)。
export default defineEval({
  description: "deliberate-fail/broken:确定性失败断言,不依赖远程调用是否成功",
  async test(t) {
    // 刻意不调用 t.send:failed 判定必须与远程网关是否可达无关——如果先 send 再判定,网关
    // 故障(如凭据被禁用)会让这条 eval 提前 errored,混淆了「断言判定失败」与「执行错误」
    // 这两件本该判然有别的事(deliberate-error 才该是 errored 的那条)。
    t.check(false, isTrue("deliberate-fail: forced failing assertion for E2E exit-code contract verification"));
  },
});
