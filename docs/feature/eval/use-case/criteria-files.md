# 判据文件:隐藏测试与参考实现

## 解决什么问题

沙箱 coding 题常用一份文件或目录树判分，例如隐藏测试、参考输出与跑测脚本。
它们的内容变化必须作废当前 Eval 的历史结果，但 Agent 开始前不能看到它们。

判据文件直接声明在 `verifier.files`。
Runner 负责发现期指纹、泄题门、Agent 结束后的上传、verification 归因和清理，不要求模块顶层登记或 `test(t)` 手工协调。

## 完整写法

```typescript
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

export default defineEval({
  async test(t) {
    await t.send("补测试把 gcov 行覆盖率提过线;不许改 tests/ 下的文件。");
  },

  verifier: {
    files: [
      {
        from: {
          root: new URL("fixtures/sqlite/with-gcov/", import.meta.url),
          ignore: ["**/__pycache__/**"],
        },
        to: "/tests",
      },
    ],
    async verify(v) {
      const result = await v.sandbox.runShell("bash /tests/run-tests.sh");
      v.check(result, commandSucceeded());
    },
  },
});
```

`test(t)` 返回后，Runner 关闭 Agent 驱动面并冻结 agent diff。
随后才上传 `/tests`、调用 `verify(v)`，最后删除受管材料。

`v` 提供断言、feedback 与受限 Sandbox 操作，不提供 `send`、`newSession` 或恢复 Agent 的入口。
隐藏性来自不可跨越的 lifecycle phase，不来自作者记住“最后一次 send 后不能再 send”的调用约定。

## 文件 source

`from` 接受项目根相对字符串、Eval 模块相对 URL，或带 `ignore` 的目录树:

```typescript
type EvalFileSource =
  | string
  | URL
  | {
      readonly root: string | URL;
      readonly ignore?: readonly string[];
    };
```

source 指向普通文件时，`to` 是目标文件绝对路径。
source 指向目录时，Runner 递归上传目录内容到 `to`，并按稳定相对路径顺序计算身份。

`ignore` 使用项目统一 glob 语义，只过滤该 source 下的相对路径。
生成物、系统文件和本地缓存都不隐式排除；作者需要明确写出不属于判据的路径。

## 指纹

Runner 在发现期解析每条 Eval 自己的文件声明。
内容、相对路径与文件类型进入 Eval 判据指纹；mtime 与宿主绝对路径不进入。

改一字节、增加文件或删除文件都只作废声明它的 Eval。
同一模块导出多条 Eval 时也按每个 EvalDef 的字段分别计算，不把模块级登记表共享给整组条目。

source 不存在、穿出项目根或符号链接逃出项目根时，发现期直接报配置错误。
静默得到空目录会让判据悄悄变窄，因此不允许。

## 泄题门

`verifier.files` 与 `privateFiles` 都是隐藏输入。
发现期把它们与当前 Eval Environment 的全部 Docker build context 和 Agent 可达 bind mount 交叉检查。

仍会进入 image、Agent 阶段 mount 或其它 Agent 可达 service 的 verifier 按配置错误拒绝。
修法是调整 `.dockerignore`、使用过滤后的 build context，或把隐藏文件移出公开 context。

`privateFiles` 用于 solution、生成器与参考答案:

```typescript
export default defineEval({
  privateFiles: [
    new URL("solution.sh", import.meta.url),
    new URL("references/", import.meta.url),
  ],
  async test(t) { /* ... */ },
});
```

private files 进入判据指纹和泄题门，但在任何运行相位都不上传。

## Verification 归因与清理

verifier 上传、`verify(v)` 产生的文件与测试临时产物属于 verification 归因。
它们不进入 agent diff，也不要求用 `diff.ignore` 防止测试 venv、coverage 或 cache 撑大 agent evidence。

上传一半失败、`verify(v)` 抛错或超时都进入清理链。
Sandbox 复用时，cleanup 是下一条 Attempt 的硬屏障；清理失败便终止该复用窗口，不能让下一条 Agent 看到残留判据。

## 动态判据

判据身份必须在 Attempt 开始前确定。
需要从远端或生成器取得判据时，先在发现期得到内容寻址、可复现的本地产物，再把它声明为 `verifier.files`。

运行期临时下载一份未进入指纹的测试会让历史结果无法比较，不提供这种便捷出口。

## 边界

- Agent 本来就应看到的起始文件写进 `fixture.files`，不写进 verifier。
- checkout、凭据派生或外部临时资源等动态题目准备写进 `EvalDef.setup`。
- Agent 运行后产生的文件是 evidence，直接通过 `v.sandbox` 或 `t.sandbox` 读取。
- 巨型模型、系统包和运行时不作为 verifier files 上传，归 Environment 或预制 Sandbox Case。
