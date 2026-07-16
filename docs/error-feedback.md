# 错误与警告反馈

niceeval 对用户说「这里有问题」的每一条消息——CLI 拒绝一次调用、运行中降级、选择器发现数据残缺、库抛出错误——都必须自带下一步。用户读完一条报错，不需要翻源码、翻文档或再问一轮就知道现在做什么；给不出下一步的报错是缺陷，与算错数字同级。

## 适用范围

本契约覆盖 niceeval 自身发出的**操作性反馈**——判据：一条消息在要求用户改变对 niceeval 的使用方式或数据状态，它就是操作性反馈，受本页约束。

| 反馈面 | 例子 | 形状与消息单源 |
|---|---|---|
| CLI 启动期错误 | 未知 flag、`exp --model` 用法拒绝、config 不可加载、`view --out` 防呆拒绝 | 本页「CLI 启动期错误的终端形状」；具体消息随对应命令 / flag 的行为契约声明 |
| 运行期 diagnostics | sandbox provisioning 重试耗尽、reporter 写失败、teardown 失败 | [`DiagnosticRecord`](feature/results/architecture.md) |
| Scope 警告 | partial-coverage、stale-snapshot | [警告 kind 全集](feature/results/library.md#警告-kind-全集) |
| 读取分类提示 | schemaVersion 不兼容、malformed / incomplete 快照 | [View · 结果版本与错误](feature/reports/view.md#结果版本与错误) |
| 库抛出的错误类 | `MalformedLocatorError`、`LocatorNotFoundError`、`copySnapshots` 预检失败 | 各 feature 文档声明的错误类 |

**被测对象的失败事实不在本契约内**：断言差异、agent 崩溃形成的 `AttemptError`、failed / errored 判定，是 eval 的结果数据，不是 niceeval 在报错。它们如何变成可行动的排查路径，由 [Scoring 的显示契约](feature/scoring/library/display.md)、[Show](feature/reports/show.md) / [View](feature/reports/view.md) 的呈现契约与公开 Debug 手册负责。

## 消息三段式

一条操作性反馈由三段组成，顺序固定：

1. **现象**：出了什么事。具体实体名——experiment id、flag 名、文件路径、provider 名——写进消息，不用「some experiments」「the snapshot」这类要用户自己回查的指代。
2. **依据**：触发判断的数据。结构化面放字段（`covered` / `total`、`startedAt`），文本面写进句子（covers 1 of 50 evals）。
3. **下一步**：用户现在能做什么。必备段，三种合法形态，至少给一种：
   - **可执行命令**：完整、已替换真实 id 的命令，复制即跑（`niceeval exp midterm/bub-gpt-5.4`）。「re-run the experiment」这类还要用户自己拼命令的指示不算命令形态，算下面的定位动作。
   - **定位动作**：没有单条命令能解决时，指出动哪里——哪个文件、哪个字段、哪一侧（"check the E2B quota for your API key"、"pass `redact` to `copySnapshots({ redact })` first"）。
   - **忽略条件**：警告类信号存在合法「不用管」场景时，写出判断条件（"if nothing changed between runs, the numbers remain comparable"），让用户按条件裁决，而不是猜这条警告严不严重。

命令与忽略条件可以并存——「要对齐就跑 X；两次跑之间没改东西可以忽略」是合格的下一步。三段都在 `message` 一个字段里：**只打印 message 的消费方不丢失下一步**，「要展示就原样打」的承诺（见 [Results Library](feature/results/library.md#选择快照resultslatest-返回-scope)）对下一步同样成立。

## 结构化承载：`command`

在 message 自含三段之上，已经结构化的反馈类型把可执行命令单列。[`ScopeWarning`](feature/results/library.md#警告-kind-全集) 与 [`DiagnosticRecord`](feature/results/architecture.md) 带可选字段：

```typescript
/** 有单条能直接推进的命令时给出，已替换真实 id，复制即跑；没有单命令形态时省略，不硬造。 */
command?: string;
```

渲染面的义务随之确定：web 面（view 的警告条与 diagnostics 区）把 `command` 呈现为可复制动作；text 面不重复打印它——同一条命令已内嵌在 message 里。程序消费方（CI 脚本）可以直接取 `command` 执行或转发，不从 message 里正则抠命令。

## CLI 启动期错误的终端形状

run 尚未激活时（argv 解析、config 加载、eval 发现、`show` / `view` 输入解析）的错误统一为两行：

```text
error: unknown option '--agnet'
  fix: use --agent <name>; run `niceeval --help` for the flag list
```

第一行 `error:` 前缀 + 现象与依据；第二行缩进两格、`fix:` 前缀 + 下一步。纯 ASCII，在 human / agent / ci 三种 output profile 与 bootstrap stderr 出口下同形。库抛出的错误类（`MalformedLocatorError` 等）的 `message` 同样按三段式携带下一步，CLI 捕获后套用这个形状，`fix:` 行直接使用错误对象自带的下一步，不在 CLI 层另行编写。

run 激活后（feedback coordinator 接管终端起）的诊断按 [CLI 反馈模型](feature/experiments/cli.md)渲染，message 自含三段，不再套 `error:` / `fix:` 外壳。

## 新增一条报错的义务

- 消息按三段式写全；能给命令就给已替换真实 id 的命令。
- `ScopeWarning` 新 kind 回[警告 kind 全集](feature/results/library.md#警告-kind-全集)登记，「下一步」是登记项的一部分；新的 diagnostic code 在引入它的 feature 文档声明，同样写明下一步。
- 在对应 feature 的 `cases.md` 登记场景行时，场景必须断言下一步在场——message 以下一步收尾、`command` 在该带时带上——不能只断言现象。

## 相关阅读

- [Results Library · 警告 kind 全集](feature/results/library.md#警告-kind-全集) —— Scope 警告逐 kind 的触发、字段与下一步。
- [Results Architecture](feature/results/architecture.md) —— `DiagnosticRecord` 的完整形状。
- [Experiments · CLI 反馈模型](feature/experiments/cli.md) —— run 激活后诊断如何渲染。
- [View · 结果版本与错误](feature/reports/view.md#结果版本与错误) —— 读取分类提示。
