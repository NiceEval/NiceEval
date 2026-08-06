# 评估多模态产物

这个 Eval 要求 Agent 生成一张图表，并判断图表是否表达参考数据。
Eval 在定义期声明 `vision` profile 需要文本和图片，规划器因此能在派发 Agent 前完成能力预检。

```ts
import { defineEval } from "niceeval";
import { material } from "niceeval/judge";

export default defineEval({
  judge: {
    llm: {
      uses: {
        vision: { media: ["text", "image"] },
      },
    },
  },
  async test(t) {
    await t.send("根据 fixtures/sales.csv 生成 output/sales.png，并解释主要趋势。");
    await t.sandbox.fileChanged("output/sales.png").gate().stopOnFailure();

    t.judge.llm({
      name: "图表与解释一致",
      profile: "vision",
      rubric: [
        "图表正确表达 reference-data 中的月份与销售额。",
        "文字解释与图表趋势一致。",
        "坐标轴和图例足以让读者理解图表。",
      ].join("\n"),
      on: [
        material.current({ id: "conversation", role: "candidate" }),
        material.file("output/sales.png", {
          id: "chart",
          role: "candidate",
          from: "sandbox",
          retention: "full",
        }),
        material.file("fixtures/sales.csv", {
          id: "reference-data",
          role: "reference",
          from: "project",
          mediaType: "text/csv",
        }),
      ],
    }).gate(0.8);
  },
});
```

材料解析器读取并 snapshot 两个文件。
图片作为 image part 进入 Provider，CSV 作为带 `reference` role 的文本 part 进入同一规范请求。

Provider 不支持 image 时，这个 Eval × Experiment pair 在预检阶段得到 `judge-capability-unavailable`。
图片不存在、过大或 MIME 不匹配时，Judge Assertion 得到 `judge-material-unavailable`，并按既有 Verdict 规则折叠。

结果详情用下面的入口复核：

```sh
pnpm exec niceeval show @<locator> --judge
```

输出先展示最终 score、理由和引用，再展示实际 profile、材料 hash、模型节点用量和重试。
图片引用可以定位到 `chart` 的归一化 region；报告不把模型理由冒充像素事实。
