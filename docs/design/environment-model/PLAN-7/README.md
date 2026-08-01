# PLAN-7:唯一 Environment 起点、受管判据与 afterAgent 边界(推荐)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md) · [DECISION](../DECISION.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 结论

每条 Attempt 仍只解析一个 Sandbox Case。
SandboxSpec setup、EvalDef setup 与 Agent setup 仍按各自 owner 准备同一个 Sandbox。

PLAN-7 补上 PLAN-6 没有覆盖的判据身份与 Agent 结束边界。
Eval 在 `criteria` 中同步声明隐藏文件，在 `test(t)` 中显式调用一次不可逆的 `t.afterAgent(...)`；callback 内上传文件、运行命令和断言都继续使用普通 API。

## 作者心智

每道 Eval 是一份自包含定义。
作者可以逐题重复环境、题面、超时与判分逻辑，不必把不同题目抽进共享函数。

作者只回答下面五个问题:

| 问题 | 写在哪里 |
|---|---|
| 这道题从什么环境启动 | `environment` |
| Agent 开始前应看到哪些文件 | `fixture.files` 或 `setup` |
| 哪些本地文件属于隐藏判据 | `criteria` |
| Agent 要完成什么 | `test(t)` 中的 `send` |
| Agent 永久结束后要做什么 | `t.afterAgent(async (after) => ...)` |

`criteria` 不携带 Sandbox 目标路径，也不发明“验证器文件”类型。
它只让 Runner 在发现期取得逐 Eval 的内容身份，并在运行期把受管 handle 交给普通上传 API。

`afterAgent` 也不等于 verify。
它只是一个生命周期闸门：进入后冻结 Agent diff，移除 `send` / `newSession` 等驱动能力；callback 可以运行测试，也可以收集公开探针或保存其它 turn 后 evidence。

Eval 模块求值应保持纯声明。
运行期 nonce、Compose project/container 名、宿主临时目录与日志收集属于 Sandbox materializer，不允许每题在 `defineEval()` 外用 `randomBytes()` 或 `mkdirSync()` 准备。

## Environment 与 setup 保持简单

Environment 只负责选择起点。
有 profile/source 时，SandboxSpec 使用 profile 覆盖或 materializer；没有 Environment 时，才使用默认 case。

Sandbox ready 后依次执行 SandboxSpec setup、EvalDef setup 与 Agent setup。
需要检查预装命中的重准备仍封装在领域 setup helper 内，执行 check、必要时 install，再 recheck。

PLAN-7 不公开 Requirement、Base contribution、融合 Base、依赖图或资源图。
Provider 不能现场组合两个起点时，SandboxSpec 提供预制完整 case，或把不支持的 Eval 明确标为 `skipped`。

## 为什么需要两条正交能力

判据指纹在 Attempt 开始前计算，隐藏材料却只能在 Agent 结束后出现。
模块顶层 `await loadCriteria(...)` 只完成身份登记，却把同步副作用和环境表泄露给作者；在 `test(t)` 尾部手工读宿主文件，又无法让发现期可靠知道哪些输入属于当前 Eval。

把“文件身份”和“运行边界”捏成 `verifier.files + verifier.verify()` 也过度特殊化：上传文件和运行测试本来就是普通 Sandbox 操作，框架不应再造一套 verifier 版本。

因此 PLAN-7 只新增:

1. `criteria`：同步、逐 Eval、无副作用的本地输入声明；
2. `afterAgent`：显式、不可逆、类型收窄的生命周期边界。

## 不抽走每题定义

PLAN-7 不新增 Terminal-Bench 专用 Eval 工厂，也不要求一份 loader 批量生成全部 Eval。
共享 helper 仍可用于真正共享的协议，但不是消除逐题重复的默认答案。

每题不同的 instruction、tags、timeout、Environment、上传目标与跑测命令继续在各自文件中完整可见。
Runner 只接管跨题都必须正确的机械契约：身份、泄题检查、边界切换、归因与失败后的复用屏障。

## 范围

本候选裁决 Environment 解析、三个 setup owner、可见 Fixture、判据文件身份与 turn 后边界。
外部 Experiment state、Agent runtime、多容器 ready/finalizer 与 Sandbox 复用继续由各自 Feature 契约定义。

## 落地路线

1. 保持 `environment`、SandboxSpec setup、EvalDef setup 与 Agent setup 的既有 owner。
2. 在 EvalDef 增加同步的 `fixture.files`、keyed `criteria` 与 `privateFiles` 声明。
3. 在 TestContext 增加只能调用一次的 `afterAgent(callback)`，callback context 不暴露 Agent 驱动面。
4. 发现期逐 Eval 解析文件树，分别写入数据指纹、判据指纹与泄题门输入。
5. `afterAgent` 入口冻结 agent diff；callback 通过普通 Sandbox API 上传 criteria handle、运行命令并断言。
6. Runner 清理受管 criteria 上传；清理或 reset 失败时禁止复用该 Sandbox。
7. 删除 `loadCriteria` / `loadPrivate` 公共面；旧 Eval 一次性迁到 EvalDef 字段，不保留双轨语义。
