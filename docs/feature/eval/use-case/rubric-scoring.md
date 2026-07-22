# 计分制：五步走完三步挣 3 分

## 解决什么问题

通过制回答「做没做对」，但有一类题的答案是「做到了几成」：安装五步走完三步，不该和一步没走同为 0 分——模型间的真实差距全藏在这里。这类题用 **`defineScoreEval`** 定义，用给分词汇叠加挣分：分从 0 往上累加、分值非负、不声明满分。同一条 eval 的代码对每个 experiment 是同一把尺子，模型 A 挣 3 分、模型 B 挣 1 分，结论不需要分母。契约单源见[计分粒度](../../experiments/score-points.md#计分制叠加给分没有上限声明)。

## 全流程

以「安装并启动 DB-GPT」为例，一条完整的检查点清单题：

```typescript
// evals/install/db-gpt.eval.ts
import { defineScoreEval } from "niceeval";
import { commandSucceeded, includes, isTrue } from "niceeval/expect";

export default defineScoreEval({
  description: "安装并启动 DB-GPT,通过健康检查",
  async test(t) {
    await t.send("把 DB-GPT 装起来,启动服务并确保健康检查通过。");

    // 前置:repo 都没 clone 下来,后面的步骤无从谈起——存在性检查用 fileExists(布尔),
    // 不是取内容的 file()(那个留给 t.check 配 matches/includes 这类内容断言)。
    const cloned = await t.sandbox.fileExists("db-gpt/README.md");
    await t.require(cloned, isTrue("db-gpt cloned"));

    // 五个检查点各值 1 分,互相独立:挂一条照记 0 分,不连坐后面
    t.sandbox.fileChanged("db-gpt/.env").points(1);                          // ① 配置了环境
    t.calledTool("shell", { input: { command: /pip install/ } }).points(1);  // ② 装了依赖
    t.calledTool("shell", { input: { command: /dbgpt start/ } }).points(1);  // ③ 启动了服务

    const health = await t.sandbox.runShell("curl -s localhost:5670/health");
    t.check(health, commandSucceeded()).points(1);                           // ④ 健康检查可达
    t.check(health.stdout, includes("ok")).points(1);                        // ⑤ 返回内容正确
  },
});
```

逐块读：

1. **检查点给分用 `.points(n)`**：挂在任何断言上的条件给分，通过挣 `n` 分、不过挣 0。五个检查点各自独立——只配好环境、装好依赖的模型挣 2 分，全走通的挣 5 分，「做到几成」直接落在分上。
2. **前置条件用 `t.require`**：不过即中止，后面的给分代码不执行，那些分**自然没挣到**。clone 都失败的模型这题挣 0 分——中止挣 0 是 agent 的责任，成立；这和基础设施故障是两回事（见边界）。
3. **判定面照旧**：这些检查点默认还是 gate，挂了任何一条 verdict 就是 failed——「没满分 = 没全过」。榜单读的是分（3 vs 1），attempt 详情里逐条红绿照常可看，「死在第几步」在那里下钻。

## 分值不等权时：rubric 大题

检查点清单是等权计分（每条 1 分）；rubric 大题的各维度分量不同，分值作者自定。三个给分形态按证据类型选：0/1 断言链 `.points`、自己算的分用 `t.score` 直接累加、judge 按连续分比例挣：

```typescript
// evals/refactor/async-rewrite.eval.ts
import { defineScoreEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

export default defineScoreEval({
  description: "回调改写 async/await,按 rubric 给分",
  async test(t) {
    await t.sandbox.uploadDirectory("fixtures/refactor-starter");
    await t.send("把 src/legacy.js 的回调全部改写成 async/await,并在 NOTES.md 写重构说明。");

    await t.group("正确性", async () => {
      const test = await t.sandbox.runCommand("npm", ["test"]);
      t.check(test, commandSucceeded()).points(60);      // 测试全过值 60 分;同时是 gate
    });

    await t.group("代码质量", async () => {
      const diff = t.sandbox.diff.get("src/legacy.js");
      const lines = diff.split("\n").filter((l) => l.startsWith("+")).length;
      t.score("代码精简", lines <= 60 ? 20 : lines <= 120 ? 10 : 0);   // 分档自己算,直接累加

      t.judge.autoevals.closedQA("重构说明是否讲清动机与风险?", {
        on: t.sandbox.diff.get("NOTES.md"),
      }).points(20);                                     // judge 打 0.8 → 挣 16 分
    });
  },
});
```

- **`.points` 与 severity 正交**：`.points(60)` 管这条值几分（分数面），gate 管挂了 verdict 怎么变（判定面）。测试没过的模型丢 60 分、verdict 也 failed，两面各自成立。
- **`t.score(label, n)`** 是判定条件复杂到断言词汇装不下时的出口：作者算好条件和分数后直接累加，`label` 进报告。
- **`t.group` 给分数命名维度**：组内挣分聚成对比里的得分点——报告里「正确性挣 60/挣 0」「代码质量挣 36/挣 12」按组横向可比，跨 eval 组名一致就能聚成同一维度。

## 边界

- **叠加不扣分**：分值非负（`.points(n)` 要求 `n > 0`，`t.score` 要求 `n ≥ 0`）。「做了坏事」不用负分——要一票否决写 gate，要「没做坏事算得分项」写正向检查点（`t.notCalledTool(...).points(1)`）。
- **中止的 0 和基础设施的 `null` 严格分开**：`require` 挂了后面挣 0 分是 agent 的责任；沙箱炸了、judge 没 key 是 `errored`，整题分数 `null`、不折成 0——评不了不是 agent 差。
- **题型即定义函数**：`defineScoreEval` 的 `t` 才有 `.points` / `t.score`，在 `defineEval` 里写给分是类型错误。一个 experiment 选中的 eval 必须同型——通过率和总分不能相加，混型是启动期配置错误，两类都要跑就写两个实验文件。
- 检查点是**独立可跑的题目**时不要用计分制，拆成多个 eval（[数据集扇出](dataset-fanout.md)）——粒度来自更多的题，不是更细的分。

## 相关阅读

- [计分粒度](../../experiments/score-points.md) —— 通过制 / 计分制的完整契约与横截面聚合规则（契约单源）。
- [过程与成本](process-and-cost.md) —— 检查点断言本身的匹配写法。
- [裁判评质量](judge-quality.md) —— judge 入口与阈值语义。
- [沙箱 coding 任务](sandbox-coding.md) —— rubric 大题依赖的 diff 归因与验证命令。
