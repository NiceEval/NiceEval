# PLAN-7:唯一 Environment 起点与受管 Eval 文件生命周期(推荐)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md) · [DECISION](../DECISION.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 结论

每条 Attempt 仍只解析一个 Sandbox Case。
SandboxSpec setup、EvalDef setup 与 Agent setup 仍按各自 owner 准备同一个 Sandbox。

PLAN-7 补上 PLAN-6 没有覆盖的 Eval 文件生命周期。
可见 Fixture 与隐藏 verifier 都写在 `defineEval({...})` 内，由 Runner 在正确相位上传、归因和清理。

## 作者心智

每道 Eval 是一份自包含定义。
作者可以逐题重复环境、题面、超时与判分逻辑，不必把不同题目抽进共享函数。

作者只回答下面五个问题:

| 问题 | 写在哪里 |
|---|---|
| 这道题从什么环境启动 | `environment` |
| Agent 开始前应看到哪些文件 | `fixture.files` 或 `setup` |
| Agent 要完成什么 | `test(t)` |
| Agent 结束后用哪些隐藏文件判分 | `verifier.files` |
| 怎样执行判分 | `verifier.verify(v)` |

文件进入哪个身份、何时上传、何时清理由字段位置决定。
作者不在模块顶层调用登记函数，也不靠 `test(t)` 中调用顺序暗示某个文件是隐藏判据。

## Environment 与 setup 保持简单

Environment 只负责选择起点。
有 profile/source 时，SandboxSpec 使用 profile 覆盖或 materializer；没有 Environment 时，才使用默认 case。

Sandbox ready 后依次执行 SandboxSpec setup、EvalDef setup 与 Agent setup。
需要检查预装命中的重准备仍封装在领域 setup helper 内，执行 check、必要时 install，再 recheck。

PLAN-7 不公开 Requirement、Base contribution、融合 Base、依赖图或资源图。
Provider 不能现场组合两个起点时，SandboxSpec 提供预制完整 case，或把不支持的 Eval 明确标为 `skipped`。

## 为什么文件必须进入定义

判据指纹在 Attempt 开始前计算，隐藏材料却只能在 Agent 结束后出现。
这要求 Runner 同时知道文件身份与运行时相位。

模块顶层 `await loadCriteria(...)` 只完成了身份登记，却把同步副作用泄露给作者。
`test(t)` 里手工上传只能完成运行时动作，却无法可靠声明发现期身份、泄题门和异常清理。

`fixture.files` 与 `verifier.files` 把两半信息放回同一份 EvalDef。
Runner 因而可以在发现期解析文件，在运行期按字段所属相位处理它们。

## 不抽走每题定义

PLAN-7 不新增 Terminal-Bench 专用 Eval 工厂，也不要求一份 loader 批量生成全部 Eval。
共享 helper 仍可用于真正共享的协议，但不是消除逐题重复的默认答案。

每题不同的 instruction、tags、timeout、Environment 与 verify 命令继续在各自文件中完整可见。
只有生命周期机械动作归 Runner:登记、上传、归因、清理和泄题检查。

## 范围

本候选裁决 Environment 解析、三个 setup owner、可见 Fixture 与 turn 后 hidden verifier。
外部 Experiment state、Agent runtime、多容器 ready/finalizer 与 Sandbox 复用继续由各自 Feature 契约定义。

## 落地路线

1. 保持 `environment`、SandboxSpec setup、EvalDef setup 与 Agent setup 的既有 owner。
2. 在 EvalDef 增加同步的 `fixture.files`、`verifier.files` 与 `verifier.verify(v)` 声明。
3. 发现期按单条 Eval 解析文件树，分别写入数据指纹、判据指纹与泄题门输入。
4. Runner 在 Agent 前上传 Fixture，在最后一次 turn 后上传 verifier files 并调用 `verify`。
5. verifier 无论成功、失败或超时都进入清理链，其写入不进入 agent diff。
6. 顶层 `loadCriteria` 保留为迁移兼容面，文档正常路径改用 EvalDef 内声明。
