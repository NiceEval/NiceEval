# Eval —— 架构

内部设计依据，解释 `defineEval` 与 `t` 的取舍；作者写 eval 的直接用法从 [`defineEval` 的形状](README.md#defineeval-的形状) 开始。
原始设计笔记与 eve 源码核对记录的出处在 memory 条目 [eval-architecture-original-notes](../../../memory/eval-architecture-original-notes.md)。

## 两条设计原则

**API 无二义。**
同一个断言词汇在任何位置都是同一个语义——不存在「`messageIncludes` 天生看全部、`calledTool` 天生看单轮」这种按名字区分的作用域。
作用域由**接收者**决定（见下节），词汇本身只有一份定义；同一件事也不提供两个 API。

**显式配置优先于约定。**
静态起始文件与隐藏判据分别写在 `fixture.files`、`verifier.files`，可见相位在调用点明确。动态 Fixture 使用 `setup` 或普通 Sandbox 操作。传统 prompt 评估的 dataset / golden 表不是一等概念；测试集仍用普通代码构造 eval 数组或 keyed record。

## 接收者模型：位置决定作用域

同一套作用域断言词汇（`succeeded` / `messageIncludes` / `calledTool` / `event` / `maxTokens` …）绑定在 `t`、session、turn 三个接收者上，绑定位置决定读哪份数据、什么时候求值。
三者的 selector 与求值时机逐行标注在 [Assertions · 作用域绑定](../assertions/architecture/scopes.md)，`outputEquals` / `outputMatches` 这类只对单轮结果有意义的能力不下放给其它接收者。

## Fixture 与 send 窗口

- Fixture 有两个显式来源。
  普通静态起始文件声明在 `fixture.files`，动态或带外部资源收尾的任务素材放 `EvalDef.setup`。
  两者都在分类账锚点之后、第一次 `send` 之前完成。
- 这两类写入都是 **eval 归因**，永不进入 agent diff——`fileChanged` / `diff` 只反映 agent 在 send 窗口内的改动（归因契约见 [Sandbox · 变更归因](../sandbox/architecture.md#变更归因send-窗口与分类账)）。
- 隐藏校验材料声明在 `verifier.files`。
  Runner 在最后一次 Agent turn 后关闭驱动面、冻结 agent diff，再上传文件并调用 `verify(v)`。
  多轮之间写入的文件会被下一轮看到，不能当隐藏材料。

## 生命周期与不变量

- eval 在 attempt 生命周期里占四个主链阶段：`eval.setup`（任务 Fixture）→ `eval.run`（`test(t)` 与全部 turn）→ `eval.verify`（受管 verifier）→ `scoring.evaluate`（断言 finalize 与判定）。`EvalDef.teardown` 在收尾段执行，只能追加 diagnostic，不改判定。
  阶段词表的唯一权威是 [Results 的 `LifecyclePhase` 闭集](../record/architecture.md#resultjson)。
- 作者写下的每条断言默认要求可评估：证据缺口使 attempt `errored`，显式 `.optional()` 才允许缺席；判定四态互斥（[Severity 与 Verdict](../verdict/architecture.md)）。
- eval id 从文件路径推导（路径即身份，禁止手写 id）；数组测试集按位置生成零填充序号 id（`sql/0000`，插删或重排会改变后续 id），keyed record 生成稳定的业务 key id（`swelancer/15193`）。
  key 是单一路径片段，发现顺序按 key 字典序固定。

## 相关阅读

- [README](README.md) —— `defineEval` 的核心契约。
- [Library](library.md) —— API 全景与组织约定;真实场景见[用例目录](use-case/README.md)。
- [Assertions Architecture](../assertions/architecture.md) —— 作用域、严重度、判定与证据不变量。
