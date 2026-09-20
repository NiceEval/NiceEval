import { customAlpha } from "../fixtures/custom-applications.ts";

export default customAlpha.defineScoreEval({
  description: "共享断言方法按调用时的应用状态登记原生 Boolean 与 measurement 分数",
  async test(t) {
    t.hasCalls(0).score(1).gate().label("独立初始状态");
    t.begin("scored-actions");
    t.append(7);
    await t.completion().score(4).gate(0.5).label("调用时读取状态").orStop();
    t.hasCalls(4).score(3).label("未匹配只贡献零分");
  },
});
