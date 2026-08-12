# 本地测试文件:普通上传与动态身份

## 解决什么问题

沙箱 coding 题常在 Agent 返回后上传隐藏测试、参考输出或跑测脚本。
这些材料需要影响缓存，也不能污染 agent diff，但它们仍只是普通文件。

不要在模块顶层登记，也不要在 EvalInput 增加文件 field。
在需要它们的位置直接调用普通 Sandbox API。

## 完整写法

```typescript
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

export default defineEval({
  async test(t) {
    await t.send("补测试把 gcov 行覆盖率提过线;不许改 tests/ 下的文件。");

    await t.sandbox.uploadDirectory(new URL("fixtures/sqlite/with-gcov/", import.meta.url), "/tests", {
      ignore: ["**/__pycache__/**"],
    });
    const result = await t.sandbox.runShell("bash /tests/run-tests.sh");
    t.check(result, commandSucceeded());
  },
});
```

`await t.send()` 返回后才执行上传，因此过去的 Agent turn 不可能通过这次上传看到 `/tests`。
若作者后面再次 `send`，下一轮能看见 `/tests`，与任何普通 Sandbox 写入一致。

## 本地 source

内存中的二进制用 `writeBytes(path, content)`；宿主文件传输用 `uploadFile(source, targetPath)`，`source` 接受相对 eval 文件的字符串或 `URL`。两个动作不再共用一个重载。
`uploadDirectory(localDir, targetDir, options)` 的 `localDir` 接受 Eval 模块相对 URL 或相对路径。

目录按稳定相对路径顺序展开。
`ignore` 使用项目统一 glob 语义，只过滤该 source 下的相对路径。

source 不存在、穿出项目根、符号链接逃逸或目录展开为空时，上传调用报清晰错误。

## 动态 transfer manifest

Runner 在普通上传实际读取本地字节时，同步写入 source tree、内容摘要、Sandbox 目标与它处于哪个 send 区间。
作者不需要把同一路径再登记一次。

首次执行产生 manifest。
后续携带在派发前重算上一份 manifest；内容、文件增删或匹配集变化都会使该 Attempt 重跑。
Eval 源码闭包变化时，旧依赖集合可能已经不完整，因此直接重跑并产生新 manifest。

## 动态泄漏检查

materializer 记下 Agent 启动前实际可见的 build/mount closure。
判定封口前，Runner 把本次 send 区间外上传的本地 source 与该 closure 比对；同一测试材料若早已对 Agent 可见，写结构化执行错误通道事件，并形成本次 Attempt 的 `errored` Verdict。Attempt lifecycle 不使用 verdict token。

首次执行只能在实际走到上传调用后知道动态 source，因此这项检查保证“不采信泄题结果”，不承诺倒流阻止首次暴露。
需要保密时，把测试材料放在 build context 外，或使用 materializer 的 filtered context。

## Solution 与参考实现

Eval 从未读取的 solution 不进入 transfer manifest，也不需要 `privateFiles` 声明。
它是否被 Dockerfile、Compose bind mount 或 image 暴露，是 template 声明一侧的隔离责任。

## 归因

agent diff 只折叠 `send` 区间内的 Sandbox 变化。
跑测上传、venv、coverage 与 cache 发生在区间外时属于 eval 归因，不需要 `diff.ignore` 或特殊 verification phase。

## 边界

- Agent 一开始就应看到的文件，在第一次 `send` 前普通上传。
- checkout、凭据派生或外部临时资源可以放 Eval layer 的 `prepare()`，cleanup 经 `context.onCleanup()` 登记。
- 内存生成的内容使用 Buffer 上传；其身份由生成它的源码或已登记数据输入承担。
- 巨型模型、系统包和运行时归 template，不在每条 Eval 中上传。
