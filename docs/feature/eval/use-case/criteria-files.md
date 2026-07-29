# 判据文件：隐藏测试与参考实现

## 解决什么问题

沙箱 coding 题的判分标准常常不是断言代码,而是一份文件——隐藏测试、参考实现、跑测脚本。
它们与 eval 同库签入(如 `evals/fixtures/`),在 `test(t)` 里写进 Sandbox 执行,执行结果决定判定。
这份文件是题目的一部分:改了它,判分口径就变了,历史结果不能再采信。
`loadText` 把它读成原文,同时把内容登记进这条 eval 的指纹——改一字节,这条 eval 自动重跑,
其它 eval 照常携带。指纹的完整判据见
[缓存与携带](../../experiments/cache.md#eval-源码闭包算到哪为止)。

用 `fs` 自行读入拿到的内容一样,但 niceeval 不知道那次读发生过:
改了判据,历史结果照常携带,复验看到的是旧判定。判据文件一律走 loader。

## 全流程

1. 判据文件放在 eval 旁边,与 eval 同库签入:

   ```text
   evals/
     react-datepicker/
       pr-6058.eval.ts
     fixtures/react-datepicker/pr-6058/
       tests/datepicker_test.test.tsx   # 隐藏测试:判分标准本体
       tests/run-tests.sh               # 跑测脚本
   ```

2. **模块顶层**用 `loadText` 读入:

   ```typescript
   // evals/react-datepicker/pr-6058.eval.ts
   import { defineEval } from "niceeval";
   import { loadText } from "niceeval/loaders";
   import { commandSucceeded } from "niceeval/expect";

   const fixture = (p: string) =>
     new URL(`../fixtures/react-datepicker/pr-6058/${p}`, import.meta.url);

   const hiddenTest = await loadText(fixture("tests/datepicker_test.test.tsx"));
   const runTests = await loadText(fixture("tests/run-tests.sh"));
   ```

3. `test(t)` 里写进 Sandbox 并执行,判定取执行结果:

   ```typescript
   export default defineEval({
     description: "react-datepicker pr-6058: changeMonth 面板错位",
     async test(t) {
       await t.send("修复 changeMonth 面板错位问题;不许改测试文件。");
       await t.sandbox.writeFiles({
         "src/test/datepicker_test.test.tsx": hiddenTest,
         "tests/run-tests.sh": runTests,
       });
       t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
     },
   });
   ```

## 只能在模块顶层调用

loader 在发现阶段的模块求值期登记「这条 eval 读了哪些文件」;
携带决策发生在任何 attempt 执行之前。`test(t)` 运行时才读,指纹早已算完——
所以发现期之外调用任何 loader 直接报错,错误信息给出下一步:把读取挪到模块顶层。
宁可大声失败,不静默漏登记。

## 路径的两种写法

- **项目根相对的字符串**:`loadText("evals/fixtures/react-datepicker/pr-6058/tests/run-tests.sh")`。
- **eval 文件相对的 URL**:`loadText(new URL("../fixtures/pr-6058/tests/run-tests.sh", import.meta.url))`。
  `URL` 是全局构造器,不需要 import `node:url`。

两种写法登记与指纹等价,选读起来顺的那种;判据文件离 eval 近就用 URL,统一收在一个数据目录就用字符串。

## 边界:什么时候改用别的

- 判据是结构化数据行(对照表、case 清单)→ [`loadYaml` / `loadJson` + 测试集扇出](dataset-fanout.md)。
- 要读的是 agent 跑出来的产物 → `t.sandbox.file` / [`t.sandbox.diff`](sandbox-coding.md)。
  那是证据,只属于产出它的那条 attempt,不进指纹。
