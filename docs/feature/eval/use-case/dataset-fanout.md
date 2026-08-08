# 测试集从输入数组生成多条 eval：一套逻辑跑一批 case

## 解决什么问题

一批只有参数不同的 case（SQL 生成对照表、issue 清单、benchmark 行）共享同一套驱动与断言逻辑。
为每行复制一个薄 `.eval.ts` wrapper 既难维护又容易漂移——从输入数组生成多条 eval的答案是普通代码：把数据行 map 成 eval **数组**或 **keyed record**，从同一文件默认导出（id 生成契约见 [Library · 测试集从输入数组生成多条 eval](../library.md#测试集从输入数组生成多条 eval)）。

## 全流程

1. 数据放 `evals/data/`，用 `loadYaml` / `loadJson` 读入：

   ```yaml
   # evals/data/sql-cases.yaml
   cases:
     - task: 统计用户数
       prompt: 查出 users 表的总行数
       sql: SELECT COUNT(*) FROM users;
     - task: 最近订单
       prompt: 查出最近 10 条订单
       sql: SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;
   ```

2. 行没有稳定业务标识时导出**数组**，位置就是身份，生成 `sql/0000`、`sql/0001`……：

   ```typescript
   // evals/sql.eval.ts
   import { defineEval } from "niceeval";
   import { loadYaml } from "niceeval/loaders";
   import { equals } from "niceeval/expect";
   import { z } from "zod";

   const SqlCases = z.object({
     cases: z.array(z.object({ task: z.string(), prompt: z.string(), sql: z.string() })),
   });
   const doc = await loadYaml("evals/data/sql-cases.yaml", (value) => SqlCases.parse(value));
   const rows = doc.cases;

   export default rows.map((row) =>
     defineEval({
       description: row.task,
       async test(t) {
         await t.send(row.prompt);
         t.succeeded();
         t.check(t.reply, equals(row.sql));
       },
     }),
   );
   ```

3. 数据源已有稳定 key（case id、issue 号、benchmark id）时导出 **keyed record**，key 就是身份，生成 `swelancer/15193`：

   ```typescript
   // evals/swelancer.eval.ts
   export default Object.fromEntries(
     rows.map((row) => [
       row.issue,
       defineEval({
         description: `SWE-Lancer ${row.issue}`,
         async test(t) {
           await t.send(row.prompt);
           t.succeeded();
         },
       }),
     ]),
   );
   ```

4. 沙箱型任务的起始文件跟着数据行走，仍是同一套写法，不需要另一种「动态 fixture」概念：

   ```typescript
   export default rows.map((row) =>
     defineEval({
       description: `审查 ${row.file}`,
       async test(t) {
         await t.sandbox.writeText(row.file, row.content);
         await t.send(`审查 ${row.file}`);
       },
     }),
   );
   ```

## 边界

- 数组 id 按**位置**生成：在中间插行会移动后续所有 id。
  测试集会增删时改用 keyed record。
- record 的 key 必须是合法路径片段（非空、不含 `/` 与 `\\`、不是 `.` / `..`）；整组条目共享同一份 `tags` / `sandbox` 声明。
- `loadYaml` / `loadJson` 必须接 decoder。解码出来的动态值只停留在 decoder 入口；验证通过后才以领域类型进入 Eval 定义。
- 传统 prompt 评估的统一 input / expected-output 表不是一等概念——逐 case 检查方式各异时，就在 map 里按行写不同断言（[设计依据](../architecture.md#两条设计原则)）。

## 相关阅读

- [Library · 测试集从输入数组生成多条 eval](../library.md#测试集从输入数组生成多条 eval) —— 两种形状与 id 生成规则的单源契约。
- [沙箱 coding 任务](sandbox-coding.md) —— 起始文件写入的完整流程。
