# 判据文件:隐藏测试与参考实现

## 解决什么问题

沙箱 coding 题常用一份文件或目录树判分，例如隐藏测试、参考输出与跑测脚本。
它们的内容变化必须作废当前 Eval 的历史结果，但 Agent 开始前不能看到它们。

判据文件在 `criteria` 中声明身份。
需要使用时，Eval 显式进入 `t.afterAgent(...)`，再把 criteria handle 交给普通 Sandbox 上传 API。
Runner 负责发现期指纹、泄题门、不可逆边界、归因与受管上传清理，不要求模块顶层登记，也不发明 verifier 专用对象。

## 完整写法

```typescript
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

export default defineEval({
  criteria: {
    tests: {
      from: new URL("fixtures/sqlite/with-gcov/", import.meta.url),
      ignore: ["**/__pycache__/**"],
    },
  },

  async test(t) {
    await t.send("补测试把 gcov 行覆盖率提过线;不许改 tests/ 下的文件。");

    await t.afterAgent(async (after) => {
      await after.sandbox.uploadDirectory(after.criteria.tests, "/tests");
      const result = await after.sandbox.runShell("bash /tests/run-tests.sh");
      after.check(result, commandSucceeded());
    });
  },
});
```

调用 `afterAgent` 时，Runner 等待未完成 turn，永久关闭本 Attempt 的 Agent 驱动面并冻结 agent diff。
callback context 不提供 `send`、`newSession` 或恢复 Agent 的入口；callback 返回后也不能再经原来的 `t` 发送 turn。

隐藏性来自不可逆 lifecycle boundary。
上传目录、运行命令和断言本身仍是普通 API，criteria 只是受管 source handle。

## 文件 source

`criteria` 的每个 value 接受项目根相对字符串、Eval 模块相对 URL，或带 `ignore` 的文件树:

```typescript
type EvalFileSource =
  | string
  | URL
  | {
      readonly from: string | URL;
      readonly ignore?: readonly string[];
    };
```

criteria declaration 不含 `to`。
目标文件或目录由 `afterAgent` 中的普通 `uploadFile(remotePath, source)` / `uploadDirectory(source, remotePath)` 调用明确给出。

目录 source 按稳定相对路径顺序递归计算身份。
`ignore` 使用项目统一 glob 语义，只过滤该 source 下的相对路径；生成物、系统文件和本地缓存都不隐式排除。

## 指纹

Runner 在发现期解析每条 Eval 自己的文件声明。
内容、相对路径与文件类型进入 Eval 判据指纹；criteria key 用于定义内寻址，但宿主绝对路径与 mtime 不进入身份。

改一字节、增加文件或删除文件都只作废声明它的 Eval。
同一模块导出多条 Eval 时也按每个 EvalDef 的字段分别计算，不把模块级登记表共享给整组条目。

source 不存在、穿出项目根或符号链接逃出项目根时，发现期直接报配置错误。
静默得到空目录会让判据悄悄变窄，因此不允许。

## 泄题门

`criteria` 与 `privateFiles` 都是隐藏输入。
发现期把它们与当前 Eval Environment 的全部 Docker build context 和 Agent 可达 bind mount 交叉检查。

仍会进入 image、Agent 阶段 mount 或其它 Agent 可达 service 的 criteria 按配置错误拒绝。
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

## after-Agent 归因与清理

`afterAgent` callback 中的上传、命令、测试临时产物与其它写入属于 after-Agent 归因，不进入 agent diff。
作者不需要用 `diff.ignore` 防止测试 venv、coverage 或 cache 撑大 agent evidence。

Runner 记录 criteria handle 经普通上传 API 写入的目标，并在 callback 结束后清理这些受管上传。
脚本自行产生的其它文件由 Attempt reset/teardown 屏障处理；Sandbox 复用时，cleanup 或 reset 失败便终止复用窗口。

## 动态判据

判据身份必须在 Attempt 开始前确定。
需要从远端或生成器取得判据时，先在发现期得到内容寻址、可复现的本地产物，再把它声明为 `criteria`。

运行期临时下载一份未进入指纹的测试会让历史结果无法比较，不提供这种便捷出口。

## 边界

- Agent 本来就应看到的起始文件写进 `fixture.files`，不写进 criteria。
- checkout、凭据派生或外部临时资源等动态题目准备写进 `EvalDef.setup`。
- Agent 运行后产生的文件是 evidence；边界前通过 `t.sandbox` 读取，边界后通过 `after.sandbox` 读取。
- `afterAgent` 不等于验证：公开探针、产物采集等任何需要 Agent 永久结束的工作也走同一边界。
- 巨型模型、系统包和运行时不作为 criteria 上传，归 Environment 或预制 Sandbox Case。
