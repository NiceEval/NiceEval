# Eval —— 架构

内部设计依据，解释 `defineEval` 与 `t` 的取舍；作者写 eval 的直接用法从 [`defineEval` 的形状](README.md#defineeval-的形状) 开始。
原始设计笔记与 eve 源码核对条目的出处在 memory 条目 [eval-architecture-original-notes](../../../memory/eval-architecture-original-notes.md)。

## 两条设计原则

**API 无二义。**
同一个断言词汇在任何位置都是同一个语义——不存在「`messageIncludes` 天生看全部、`calledTool` 天生看单轮」这种按名字区分的作用域。
作用域由**接收者**决定（见下节），词汇本身只有一份定义；同一件事也不提供两个 API。

**普通顺序优先于额外状态机。**
文件上传、Agent turn、命令和断言都按 `test(t)` 的 TypeScript 顺序执行。传统 prompt 评估的 dataset / golden 表不是一等概念；测试集仍用普通代码构造 eval 数组或 keyed record。

**模块求值保持纯声明。**
发现期可以用普通 TypeScript 构造 EvalDefinition，但运行期 nonce、宿主临时目录和日志收集属于 Sandbox materializer。
把 `randomBytes()`、`mkdirSync()` 或登记 loader 放在 `defineEval()` 外，会制造没有 Attempt owner 的副作用，也会污染稳定身份。

## 接收者模型：位置决定作用域

同一套作用域断言词汇（`succeeded` / `messageIncludes` / `calledTool` / `event` / `maxTokens` …）绑定在 `t`、session、turn 三个接收者上，绑定位置决定读哪份数据、什么时候求值。
三者的 selector 与求值时机逐行标注在 [Assertions · 作用域绑定](../assertions/architecture/scopes.md)，`outputEquals` / `outputMatches` 这类只对单轮结果有意义的能力不下放给其它接收者。

## 文件传输与 send 区间

- 起始文件在第一次 `send` 前通过普通 Sandbox API 上传；动态或带外部资源收尾的任务素材也可以放 Eval layer 的 `prepare()`，cleanup 经 `context.onCleanup()` 登记。
- `fileChanged` / `diff` 只反映 Agent 在 send 区间内的改动。区间外的上传与命令属于 eval 归因。
- 测试文件在对应 `send` 返回后普通上传。作者随后再次 `send` 时，新一轮会看见这些文件，这是顺序语义，不是错误。

## 生命周期与不变量

- eval 的准备命令记 `sandbox.prepare`（诊断按 owner 细分），主链随后是 `eval.run` → `assertions.evaluate`。
  `eval.run` 按真实顺序涵盖普通文件传输、全部 turn、命令与断言条目。
  已登记 cleanup 在收尾段逆序执行，失败只追加 diagnostic，不改判定。
  阶段词表的唯一权威是 [Results 的 `LifecyclePhase` 闭集](../record/architecture.md#resultjson)。
- 作者写下的每条断言默认要求可评估：证据缺口使 attempt `errored`，显式 `.optional()` 才允许缺席；判定四态互斥（[Severity 与 Verdict](../verdict/architecture.md)）。
- eval id 从文件路径推导（路径即身份，禁止手写 id）；数组测试集按位置生成零填充序号 id（`sql/0000`，插删或重排会改变后续 id），keyed record 生成稳定的业务 key id（`swelancer/15193`）。
  key 是单一路径片段，发现顺序按 key 字典序固定。

## 相关阅读

- [README](README.md) —— `defineEval` 的核心契约。
- [Library](library.md) —— API 全景与组织约定;真实场景见[用例目录](use-case/README.md)。
- [Assertions Architecture](../assertions/architecture.md) —— 作用域、严重度、判定与证据不变量。
