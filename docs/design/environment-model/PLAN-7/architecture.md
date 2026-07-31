# PLAN-7 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 数据模型

```text
EvalDef
├── Environment profile/source
├── fixture.files             visible before Agent
├── setup / teardown          dynamic Eval preparation
├── test(t)                   Agent interaction
├── verifier.files            hidden until Agent finishes
├── verifier.verify(v)        verification only
└── privateFiles              never uploaded

Attempt
├── one resolved Sandbox Case
├── SandboxSpec / EvalDef / Agent setup activities
├── managed file activities
├── Agent turns
└── verifier assertions and cleanup
```

文件声明属于 EvalDef，不属于 Environment。
Environment 决定 Sandbox 从哪里启动；文件字段决定题目材料何时进入已经启动的 Sandbox。

## 文件身份与运行相位分开

发现期为每条 Eval 分别解析三个文件集合:

| 集合 | 身份 | 运行时行为 |
|---|---|---|
| `fixture.files` | Eval 数据指纹 | Agent 前上传 |
| `verifier.files` | Eval 判据指纹 | Agent 后上传、verify 后删除 |
| `privateFiles` | Eval 判据指纹 | 永不上传 |

一条 Eval 的文件只影响该 Eval。
同一模块定义多条 Eval 时，Runner 也按 EvalDef 字段分别计算，不把模块求值期的环境登记表共享给全部条目。

## 泄题门

`verifier.files` 与 `privateFiles` 都是隐藏输入。
发现期把它们与该 Eval Environment 的全部 Docker build context 和 Agent 可达 bind mount 交叉检查。

verifier 可以在判分相位挂入主 Sandbox，但不能在 Agent 相位经 image、build context 或其它 service 提前可见。
private files 在任何相位都不能进入 Sandbox。

Runner 不提供 waiver。
上游 task package 把 verifier 放进 build context 时，作者必须用 `.dockerignore`、过滤后的 context 或安全的目录布局修正泄漏。

## Verifier phase

`test(t)` 完成并不自动等于 Agent 已经永远结束。
Runner 在 `test(t)` 返回时确认没有未完成 turn，然后封闭 Agent 驱动面，再进入 `eval.verify`。

进入 verifier phase 后:

1. 冻结 agent diff 与 turn evidence。
2. 上传 `verifier.files`。
3. 调用 `verifier.verify(v)`。
4. finalize verifier assertions。
5. 删除受管文件并记录清理结果。

verifier 写入属于 eval verification 归因。
它不能扩大 agent diff，也不需要作者用 `diff.ignore` 排除测试 venv、coverage 或临时输出。

## Environment 解析与 setup

规划器仍按单一起点解析:

```text
Eval profile/source
  -> environments[profile]
  -> matching materializer(source)
  -> skipped when unsupported

no Eval Environment
  -> SandboxSpec default case
  -> Provider neutral case
```

Sandbox ready 后依次执行 SandboxSpec setup、workspace baseline、EvalDef setup 与 Agent setup。
可见 Fixture 在 Agent setup 前上传；verifier files 不参与任何 setup。

## 身份与记录

```text
Run configHash
  += SandboxSpec, materializers, Experiment setup helper identities, Agent

Per-Eval fingerprint
  += Eval source and loaded data
  += Environment source/profile and selected case identity
  += fixture.files content tree
  += verifier.files and privateFiles content tree
  += Eval setup identity
```

Attempt 记录保存受管文件的 source identity、Sandbox 目标、上传 activity、verify activity 与清理 diagnostic。
记录只保存项目相对路径和内容摘要，不复制 private file 内容。

## 不建立通用文件流水线

`fixture.files` 与 `verifier.files` 只表达稳定的两个可见相位。
它们不接受任意 phase 名、不组成依赖图，也不允许作者定义第三套上传时机。

动态 Fixture 使用 EvalDef setup，运行中由 Agent 产生的 evidence 从 Sandbox 读取。
这三条路径覆盖真实 owner，不把文件系统操作抽象成通用 workflow engine。
