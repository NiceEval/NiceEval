import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

// 改编自 ponytail 的 csv-sum 测试。
//
// 任务故意很简单：读 CSV、求 amount 列的和。
// 没有 ponytail skill 的 agent 通常会引入 pandas 或手写 CSV parser 类；
// 有 skill 的 agent 会先问"标准库能解决吗？"然后用 csv.DictReader 一次性搞定。
export default defineEval({
  description: "读取 sales.csv 并求 amount 列的和（应用标准库，不引入 pandas）",

  async test(t) {
    await t.sandbox.uploadDirectory("../workspaces/ts-starter");

    await t.sandbox.writeFiles({
      "sales.csv": ["id,product,amount", "1,Widget A,100.5", "2,Widget B,200.0", "3,Widget C,50.5"].join("\n"),
    });

    await t
      .send(
        "写 Python 代码读取 sales.csv，计算并打印 amount 列的总和。" +
          "把代码放在 sum_sales.py 里，直接运行文件就能输出结果。",
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles({ extensions: ["py"] });
    const code = src.text();

    await t.group("使用标准库（csv 模块）", () => {
      // 有 skill 的 agent 会发现 csv.DictReader 足够，不用 pandas
      t.check(code, includes(/import csv|csv\.DictReader|csv\.reader/));
    });

    await t.group("输出结果为 351.0 或 351", async () => {
      const result = await t.sandbox.runCommand("python3", ["sum_sales.py"]);
      // 输出 "351" 或 "351.0" 都接受
      t.check(result.stdout.trim(), includes(/^351(\.0)?$/));
    });

    t.sandbox.fileChanged("sum_sales.py");

    t.judge.autoevals
      .closedQA(
        "实现是否简洁？是否用了 csv 标准库而非 pandas？" +
          "代码行数是否在合理范围内（理想 ≤ 10 行）？",
        { on: code },
      )
      .atLeast(0.7);
  },
});
