# 判据文件：隐藏测试与参考实现

## 解决什么问题

沙箱 coding 题的判分标准常常不是断言代码,而是一份文件或一棵目录树——隐藏测试、参考实现、跑测脚本。它们与 eval 同库签入(如 `evals/fixtures/`),在 `test(t)` 里送进 Sandbox 执行,执行结果决定判定。这些文件是题目的一部分:改了它们,判分口径就变了,历史结果不能再采信。

登记进指纹有两条路,按「内容要不要进内存」选:

| 判据形态 | loader | 行为 |
|---|---|---|
| 单个文件,内容要写进沙箱 | `loadText` | 读入原文并登记,返回内容 |
| 一整棵树,内容整体上传 | `loadCriteria` | 只登记,流式哈希,返回匹配路径清单 |

改一字节、增删一个文件,引用它的那条 eval 自动重跑,其它 eval 照常携带。
指纹的完整判据见[缓存与携带](../../experiments/cache.md#eval-源码闭包算到哪为止)。

用 `fs` 自行读入拿到的内容一样,但 niceeval 不知道那次读发生过:改了判据,历史结果照常携带,复验看到的是旧判定。判据文件一律走 loader。

## 单个文件:`loadText` 读入即登记

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

## 判据树:`loadCriteria` 登记不读入

判分标准是一棵树(每题几百个测试文件加跑测脚本)、断言只消费执行结果时,内容不需要进内存:上传走 `uploadDirectory`,判定看跑测脚本的退出码。`loadCriteria` 只做登记——发现期展开 glob、把每个匹配文件流式哈希进这条 eval 的指纹,返回排序后的项目根相对路径清单。

```typescript
// evals/sqlite/with-gcov.eval.ts
import { defineEval } from "niceeval";
import { loadCriteria } from "niceeval/loaders";
import { commandSucceeded } from "niceeval/expect";

await loadCriteria("evals/fixtures/sqlite/with-gcov/tests/**", "!**/__pycache__/**");

export default defineEval({
  description: "sqlite: 把 gcov 行覆盖率补过线",
  async test(t) {
    await t.send("补测试把 gcov 行覆盖率提过线;不许改 tests/ 下的文件。");
    await t.sandbox.uploadDirectory("../fixtures/sqlite/with-gcov/tests", "tests");
    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
```

匹配规则:

- include 是项目根相对的 glob 字符串,或 `{ pattern, relativeTo: import.meta.url }`(见[路径的两种写法](#路径的两种写法));`!` 前缀字符串为排除,按声明顺序求值,后写的覆盖先写的。
- 匹配集按文件系统枚举,不看 git:新写的判据没 `git add` 也照样进指纹。
  代价是生成物同样被盖到——本地跑一次测试冒出的 `__pycache__`、系统或编辑器文件都会改变指纹、作废引用这棵树的 eval。生成物用 `!` 排除;niceeval 不内置排除表。
- 增删文件与改内容同等作废;权限位与修改时间不进哈希,重新 `git clone` 一份工作树不作废。
- 匹配落到项目根外(符号链接穿出根)按用法错误报出,与源码闭包的静态面同判据。
- 每个 include pattern 都必须匹配到至少一个文件,匹配不到就按用法错误报出——多半是写错了或文件搬走了;别的 pattern 有命中也不放过,静默放过等于判据悄悄变窄。`!` 排除不受此约束。

作废面与源码闭包同理是 1 对 N 的:被多题共享的跑测脚本改一行,共享它的每题都重跑。
想缩小作废面,按题拆目录、按变更频率拆 pattern。

改了判据没有「强制沿用旧结果」的出口,这是有意的:判据变了,旧判定就不能采信,宁可多烧一次。
判据没变但要重跑走 [`--rerun`](../../experiments/use-case/重新运行/)。

## 只能在模块顶层调用

loader 在发现阶段的模块求值期登记「这条 eval 的判据是哪些文件」;携带决策发生在任何 attempt 执行之前。`test(t)` 运行时才读,指纹早已算完——所以发现期之外调用任何 loader 直接报错,错误信息给出下一步:把读取挪到模块顶层。
宁可大声失败,不静默漏登记。

## 路径的两种写法

单文件 loader 的路径两种写法登记与指纹等价,选读起来顺的那种:

- **项目根相对的字符串**:`loadText("evals/fixtures/react-datepicker/pr-6058/tests/run-tests.sh")`。
- **eval 文件相对的 URL**:`loadText(new URL("../fixtures/pr-6058/tests/run-tests.sh", import.meta.url))`。
  `URL` 是全局构造器,不需要 import `node:url`。

单个判据文件离 eval 近就用 URL,统一收在一个数据目录就用字符串。

`loadCriteria` 的 include pattern 同样有两种写法:项目根相对字符串,或 `{ pattern: "tests/**", relativeTo: import.meta.url }`。
后一种把 glob 与基准 URL 分开,所以 `?`、`[...]`、`{a,b}` 保持 glob 字符,不会被 URL parser 当成 query、编码或 fragment。
两种 include 写法登记与指纹等价。

`!` 排除只收字符串,统一按项目根相对求值。
匹配对象是此前全部 include 展开出的项目根相对路径;它不跟随任何一条 include 的基准。
include 有几条、采用哪种写法都不改变排除的含义。
要排除任意深度的生成物写 `!**/__pycache__/**`。

## 边界:什么时候改用别的

- 判据是结构化数据行(对照表、case 清单)→ [`loadYaml` / `loadJson` + 测试集从输入数组生成多条 eval](dataset-fanout.md)。
- 巨型二进制产物(模型权重、数据集镜像)不是判据,归 Sandbox 环境面(预制模板 / environment profile);`loadCriteria` 服务的是决定判分口径的文本树。
- 要读的是 agent 跑出来的产物 → `t.sandbox.file` / [`t.sandbox.diff`](sandbox-coding.md)。
  那是证据,只属于产出它的那条 attempt,不进指纹。
