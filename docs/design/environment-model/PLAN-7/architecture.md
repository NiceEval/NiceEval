# PLAN-7 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 数据模型

```text
EvalDef
├── Environment profile/source
├── fixture.files             visible before Agent
├── setup / teardown          dynamic Eval preparation
├── criteria                  hidden local input identities
├── test(t)                   Agent interaction
│   └── t.afterAgent(after)   irreversible lifecycle boundary
└── privateFiles              never uploaded

Attempt
├── one resolved Sandbox Case
├── SandboxSpec / EvalDef / Agent setup activities
├── Agent turns
├── frozen agent evidence
└── ordinary after-Agent sandbox operations and assertions
```

文件声明属于 EvalDef，不属于 Environment。
Environment 决定 Sandbox 从哪里启动；Fixture 决定 Agent 前的固定上传；criteria 只声明隐藏输入身份；`afterAgent` 决定何时永远关闭 Agent 驱动面。

## 文件身份与运行相位分开

发现期为每条 Eval 分别解析三个文件集合:

| 集合 | 身份 | 运行时行为 |
|---|---|---|
| `fixture.files` | Eval 数据指纹 | Agent 前按声明目标上传 |
| `criteria` | Eval 判据指纹 | 只在 `afterAgent` 中作为普通上传 source 使用 |
| `privateFiles` | Eval 判据指纹 | 永不上传 |

同一模块定义多条 Eval 时，Runner 按各自 EvalDef 计算，不把模块求值期的登记表共享给全部条目。

criteria key 不是全局 id，也不进入 Sandbox 路径。
上传到哪里、创建什么目录、运行什么命令都留在当前 Eval 的 `afterAgent` callback 中。

## 模块求值没有运行期副作用

发现 Eval 可以执行普通 TypeScript 来构造定义，但不能把 Sandbox 运行期准备偷放进模块顶层。
模块顶层的随机容器名会污染稳定身份，宿主 `mkdirSync` 也没有 Attempt owner，失败时无法进入 lifecycle 记录与清理链。

Compose project 名、容器名、临时目录与日志归档由 materializer 按 Attempt 创建。
Eval 只声明稳定的 Compose source 与确有必要的静态 env；这些运行期值不需要作者手工插值。

## 泄题门

`criteria` 与 `privateFiles` 都是隐藏输入。
发现期把它们与该 Eval Environment 的全部 Docker build context 和 Agent 可达 bind mount 交叉检查。

criteria 可以在 after-Agent 相位经普通 API 上传到主 Sandbox，但不能在 Agent 相位经 image、build context 或其它 service 提前可见。
private files 在任何相位都不能进入 Sandbox。

Runner 不提供 waiver。
上游 task package 把隐藏材料放进 build context 时，作者必须用 `.dockerignore`、过滤后的 context 或安全的目录布局修正泄漏。

## afterAgent phase

`test(t)` 的函数边界不能表达“此后绝不再发 turn”，因为作者需要在同一段逐题流程中接着执行普通 Sandbox 操作。
`t.afterAgent(...)` 因而是显式状态转换，而不是特殊化 verifier hook。

进入 `eval.afterAgent` 时:

1. 等待当前 turn 完成并关闭 Agent 驱动面；
2. 冻结 agent diff 与 turn evidence；
3. 给 callback 一个不含 Agent 能力、但含 criteria handles 的收窄 context；
4. callback 用普通上传、命令、读取与断言 API 完成工作；
5. callback 结束后清理受管 criteria 上传，并封闭 after-Agent assertions。

该 phase 的所有写入属于 after-Agent 归因，不能扩大 agent diff。
Runner 不要求作者用 `diff.ignore` 排除测试 venv、coverage 或临时输出。

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
可见 Fixture 在 Agent setup 前上传；criteria 不参与任何 setup。

## 身份与记录

```text
Run configHash
  += SandboxSpec, materializers, Experiment setup helper identities, Agent

Per-Eval fingerprint
  += Eval source and loaded data
  += Environment source/profile and selected case identity
  += fixture.files content tree
  += criteria and privateFiles content tree
  += Eval setup identity
```

Attempt 记录保存受管文件的 source identity、普通上传 activity、after-Agent 命令与清理 diagnostic。
记录只保存项目相对路径和内容摘要，不复制 private file 内容。

## 不建立 verification 子框架

PLAN-7 不增加 `Verifier`、`VerifyContext`、`verify()`、专用上传方法或 verifier assertion 类型。
文件 IO、Sandbox 命令和断言已有普通 API；新设计只补它们缺少的发现期身份和生命周期边界。

`fixture.files` 保留声明式 mount，是因为它有一个固定且无歧义的 Agent 前目标相位。
criteria 没有固定目标和用途，因此不接受 `to`，也不组成任意 phase 或依赖图。
