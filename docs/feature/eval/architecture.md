# Eval —— 架构

内部设计依据，解释 `defineEval` 与 `t` 的取舍；作者写 eval 的直接用法从 [`defineEval` 的形状](README.md#defineeval-的形状) 开始。
原始设计笔记与 eve 源码核对记录的出处在 memory 条目 [eval-architecture-original-notes](../../../memory/eval-architecture-original-notes.md)。

## 两条设计原则

**API 无二义。**
同一个断言词汇在任何位置都是同一个语义——不存在「`messageIncludes` 天生看全部、`calledTool` 天生看单轮」这种按名字区分的作用域。
作用域由**接收者**决定（见下节），词汇本身只有一份定义；同一件事也不提供两个 API。

**显式配置优先于约定。**
起始文件、workspace、测试集全部用基本 API 写成普通代码，没有隐式拷贝、没有约定式黑箱：fixture 是 `test(t)` 里的显式 `writeFiles` / `uploadDirectory` 调用；传统 prompt 评估的 dataset / golden 表不是一等概念——Agent eval 关注多轮对话、逐 case 各异的检查方式，统一的 input / expected-output 表装不下，需要测试集时用普通代码把数据行 map 成 eval 数组，或按外部稳定业务 key 组装成 eval record（[测试集从输入数组生成多条 eval](library.md#测试集从输入数组生成多条 eval)）。

## 接收者模型：位置决定作用域

同一套作用域断言词汇（`succeeded` / `messageIncludes` / `calledTool` / `event` / `maxTokens` …）绑定在 `t`、session、turn 三个接收者上，绑定位置决定读哪份数据、什么时候求值。
三者的 selector 与求值时机逐行标注在 [Assertions · 作用域绑定](../assertions/architecture/scopes.md)，`outputEquals` / `outputMatches` 这类只对单轮结果有意义的能力不下放给其它接收者。

## Fixture 与 send 窗口

- Fixture 有两个显式来源。
  普通起始文件在 `test(t)` 里用 `writeFiles` / `uploadDirectory`写入。
  需要提前准备、耗时较长或带外部资源收尾的任务素材放 `EvalDef.setup`。
  两者都在分类账锚点之后、第一次 `send` 之前完成。
- 这两类写入都是 **eval 归因**，永不进入 agent diff——`fileChanged` / `diff` 只反映 agent 在 send 窗口内的改动（归因契约见 [Sandbox · 变更归因](../sandbox/architecture.md#变更归因send-窗口与分类账)）。
- 隐藏校验材料写在**最后一次** `t.send()` 返回后，且此后不得再发起 `send`。
  这样 agent 看不到，材料也不进入 agent diff。
  多轮之间写入的文件会被下一轮看到，不能当隐藏材料。

## 生命周期与不变量

- eval 在 attempt 生命周期里占三个主链阶段：`eval.setup`（任务 Fixture）→ `eval.run`（整段 `test(t)`，含全部 send 与手工命令）→ `scoring.evaluate`（断言 finalize 与判定）；`EvalDef.teardown` 在收尾段执行，只能追加 diagnostic，不改判定。
  阶段词表的唯一权威是 [Results 的 `LifecyclePhase` 闭集](../record/architecture.md#resultjson)。
- 作者写下的每条断言默认要求可评估：证据缺口使 attempt `errored`，显式 `.optional()` 才允许缺席；判定四态互斥（[Severity 与 Verdict](../verdict/architecture.md)）。
- eval id 从文件路径推导（路径即身份，禁止手写 id）；数组测试集按位置生成零填充序号 id（`sql/0000`，插删或重排会改变后续 id），keyed record 生成稳定的业务 key id（`swelancer/15193`）。
  key 是单一路径片段，发现顺序按 key 字典序固定。

## 相关阅读

- [README](README.md) —— `defineEval` 的核心契约。
- [Library](library.md) —— API 全景与组织约定;真实场景见[用例目录](use-case/README.md)。
- [Assertions Architecture](../assertions/architecture.md) —— 作用域、严重度、判定与证据不变量。
