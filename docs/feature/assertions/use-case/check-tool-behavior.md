# 检查指定会话范围内的工具行为

## 用户目标

评估作者要证明 Agent 在同一会话中先检索、后汇报，并确认所有会话都没有调用删除工具。

## 起始状态

已有 Experiment `research`，其 Adapter 产出原始名称为 `search` 与 `delete_file` 的工具事件。
为了判定没有调用工具，Adapter 必须提供足以证明这一点的 actions 材料。
本页未实际调用 Agent，所有结果均为预期输出。

## 完整路径

1. 在 Eval 目录保存 `tool-scope.ts`，分别在 Turn、Session 与根 `t` 上登记检查。 {#author}

   ```ts
   import { defineEval } from "niceeval";
   import { toolMatch } from "niceeval/expect";

   export default defineEval({
     description: "检索后汇报且不删除文件",
     async test(t) {
       const session = t.newSession();
       const searched = await session.send("最近一次发布改了哪些东西？");
       searched.calledTool(toolMatch("search").atLeast(1))
         .label("本轮进行检索");

       const summary = await session.send("就按刚才查到的内容，给我写三句话的总结。");
       summary.usedNoTools().label("汇报轮不用工具");
       session.calledTool("search").label("会话包含检索");

       await t.send("顺便看看 CHANGELOG 里有没有错别字。");
       t.notCalledTool("delete_file").label("全部会话未删除文件");
     },
   });
   ```

   预期输出：`searched` 的检查只看检索轮；`summary` 的检查只看汇报轮。
   `session` 的检查能看见两轮；最后的根检查包含主会话和独立会话在调用处已发生的工具行为。

2. 执行 Eval，检查工具事实与材料缺口。 {#run}

   ```sh
   niceeval exp research tool-scope
   ```

   | 观察到的事实 | 预期输出 |
   |---|---|
   | 检索轮调用 search，汇报轮不用工具，所有会话未调用 delete_file，材料完整 | 四项匹配，Attempt 为 `passed`。 |
   | 任一会话已经调用 delete_file | 根检查不匹配，Attempt 为 `failed`。 |
   | 没看到 delete_file，但 actions 材料不足以证明没有发生 | 负断言为 unavailable，不能按空事件判为通过。 |

## 结果

相同的工具断言按用户选择的接收者检查相应范围。
先登记的检查保留调用处的事实；后续发送不能改写它。

## 相关契约

- [Scoped assertions](../library/scoped-assertions.md)：工具选择、计数、接收者范围与未知材料。
- [Evidence](../architecture/evidence.md)：证据完整度。
- [Eval context](../../eval/library/context.md)：创建 Session 与发送消息。
- [Experiment CLI](../../experiments/cli/README.md#命令)：执行入口。
