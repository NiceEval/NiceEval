# 工作目录访问证据

工作目录变化只能说明 Agent 最终改了什么，工具输入中的 JSON 只能说明 Adapter 投影出的文本。两者都不能证明 Agent 进程是否读取、写入或重命名过工作目录中的一个路径。

本 Roadmap 为这类问题建立 Attempt-scope 的访问 evidence。Eval 在定义期以 `workspaceAccess: { collection: "required" | "best-effort" }` 声明要求，随后在 t.sandbox 上登记一次 post-run Assertion。Runner 在 Agent 与其子进程结束后结算该 Assertion，并把可复核的有限 evidence 封入 Attempt。

## 解决的 Frog / DX

Frog 中的路径摩擦来自两个不可靠替代品：把工具输入中的字符串当成文件访问，或把最终 diff 当成全部读写历史。前者漏掉未被 Adapter 投影的进程行为，后者漏掉读取、还原后的写入和失败操作。

作者需要写出“Agent 读取了配置”与“Agent 没有碰过秘密目录”，而不必猜工具 schema、shell 文本或 Provider 的工作目录。诊断者也需要知道结果来自完整、部分还是不可用的 evidence。

## 核心心智

工作目录访问 collection 属于 Eval 的执行要求，不属于某一条 Assertion 的严重度。Eval 的 workspaceAccess 声明决定 Runner 是否必须取得完整 evidence；accessedWorkspace 与 didNotAccessWorkspace 只描述如何解释这一份 Attempt evidence。

required Provider 不支持这项能力时，link 以 `sandbox.workspace-access-unsupported` 失败，且零 Agent 启动。已支持 Provider 运行中形成任何 partial 或 unavailable 时，required Attempt 仍直接 errored；正向 witness 不能挽救它。best-effort 才使用三值 matcher。

访问 Assertion 固定在 post-run 结算。collection 只纳入 Agent runtime 及其子进程的工作目录文件系统操作。Eval prepare、测试代码、Provider build 与收尾动作都不纳入。

每个路径都经真实 symlink 跟随并规范化为工作目录相对路径。跟随后逃出工作目录的操作都是独立的执行错误，不能被正向 witness、optional Assertion 或 matcher 选择掩盖。

## 范围

本方向包含：

- Eval 预声明 required 或 best-effort 的工作目录访问 collection；
- t.sandbox.accessedWorkspace 与 t.sandbox.didNotAccessWorkspace 两个 post-run Assertion；
- 八种公开动作、完整、部分与不可用 evidence 的三值求值；
- symlink 后路径规范化、逃逸拒绝和有限审计 evidence；
- 将 referencesAnyPath 替换为明确表达 JSON 文本语义的 jsonMentionsAnyPath。

本方向不包含：

- 通用 syscall 流、任意 Sandbox 路径审计或实时订阅 API；
- 把工具 JSON、stdout、Agent 回复或 diff 解释成访问 evidence；
- 为访问 Assertion 新增 CLI 命令、flag、Report 专用资源或独立 Record family；
- 让 evaluator 私有资产以运行时监控代替 build、mount、cache 与 Agent namespace 的物理隔离。

## Assertion 决策

工作目录访问是本方向唯一新增的 Eval Assertion。它的公开 owner 是 Sandbox Eval 的 t.sandbox；结果仍是 Assertions Attachment 中的一条普通 post-run Boolean entry。

collection 的 owner 是 Eval，evidence 与 entry 的 owner 是 Attempt。它们不跨 Attempt、Sandbox 复用周期、Run 或结果携带共享。

## 所有权与身份

| 事实 | owner | identity |
| --- | --- | --- |
| workspaceAccess collection 要求 | Eval definition | collection 模式进入 Eval 执行输入 |
| 访问 collector、工作目录真实根与 collection 时段 | Attempt | attemptId 与该次物理 Agent namespace |
| 一条访问 Assertion 的 matcher、policy 与展示 | Assertions entry | attachment-local entryId |
| 规范化 operation、witness、limitation 与 unavailable reason | Assertions entry | matcher identity + Attempt evidence |
| evaluator 私有资产 | evaluator | 不进入 build、mount、cache 或 Agent namespace |

collection 模式不是 Assertion 的 key、label、optional policy 或分数。改变 collection 模式会改变 Eval 的执行输入；只改展示字段不会。

## 入口

- [Library](library.md) — Eval 声明、动作、operation、两条 Assertion 与 JSON 文本 Match。
- [CLI](cli.md) — 既有命令怎样展示计划、结果、JSON 与退出语义。
- [Architecture](architecture.md) — collection 时序、路径边界、evidence 封口与物理隔离。
