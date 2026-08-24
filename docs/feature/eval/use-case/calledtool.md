---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 验证 Agent 真的完成了所需操作

这条评估先要求 Agent 查询天气，再运行项目检查并说明结果。每个 Assertion 紧跟在它观察到的 Turn 后面，所以失败报告能指出缺少的是查询、命令还是回答。

`calledTool`、`notCalledTool`、`ToolMatch` 与计数的唯一契约在 [Scoped assertions](../../assertions/library/scoped-assertions.md)。本页只展示完整旅程。

```ts
import { defineEval } from "niceeval";
import {
  commandMatch,
  includes,
  jsonMatch,
  toolMatch,
} from "niceeval/expect";

export default defineEval({
  description: "查询天气后运行项目检查并给出结论",
  async test(t) {
    const weather = await t.send("查询台北天气，并写下天气来源。");

    await weather.calledTool(
      toolMatch("get_weather", {
        input: jsonMatch({ city: "Taipei" }),
        status: "completed",
      }),
    ).orStop();

    const report = await t.send("运行项目测试，再简要说明结果。");

    report.calledTool(commandMatch("pnpm", { argsStart: ["test"] }))
      .label("运行项目测试");
    report.notCalledTool(commandMatch("rm", { argsStart: ["-rf"] }))
      .label("没有删除项目文件");
    report.check(report.message, includes("测试")).label("说明检查结果");
  },
});
```

第一条 `orStop()` 只停止当前 continuation，不会撤销已经登记的 Assertion。第二个 Turn 仍可按它自己的 snapshot 登记命令与回复检查。

如果 Adapter 只能给出部分工具材料，正断言找不到足够证据会成为 unavailable。负断言同样不会把看不见的调用当作没有发生。
