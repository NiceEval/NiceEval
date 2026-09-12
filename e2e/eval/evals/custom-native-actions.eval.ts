import { equals } from "niceeval/expect";
import { customAlpha, customIdentityReporter } from "../fixtures/custom-applications.ts";

export default customAlpha.defineEval({
  description: "同一 Adapter contract 的具体实现执行自己的原生动作",
  reporters: [customIdentityReporter],
  async test(t) {
    const expectedImplementation = t.flags.implementation;
    const opened = t.begin("native-actions");
    const { append } = t;
    const first = append(2);
    const second = append(5);
    const completed = t.finish();

    t.check(t.implementation, equals(expectedImplementation)).label("选中的实现创建实例");
    t.check(opened, equals({ sequence: 1, title: `${expectedImplementation}:native-actions` }))
      .label("Adapter 方法保留原生返回值");
    t.check([first, second], equals([
      { sequence: 2, total: 2 },
      { sequence: 3, total: 7 },
    ])).label("多个 Adapter 动作共享本 Attempt 状态");
    t.check(completed, equals({ sequence: 4, summary: `${expectedImplementation}:7` }))
      .label("每个 Attempt 从独立实例完成");
    t.check(t.calls, equals(4)).label("解构方法绑定 Adapter 且根字段实时读取");
  },
});
