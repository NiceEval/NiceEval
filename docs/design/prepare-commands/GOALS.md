**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

---

## 目的

在不改变已定稿执行模型的前提下,让准备声明的成本与语义更具体:作者能在计划面看见复用省什么,常见昂贵动作有官方的、身份稳定的写法。

## 设计原则

- 频次与顺序不重开。逐 Attempt 重新执行、template owner 先、检查换 scope 是[Sandbox 模型 DECISION](../environment-model/DECISION.md)的裁决,本主题的一切候选都在它之上。
- 任何内置命令 只能建在 `prepare()` 与 `defineSandboxCommand()` 之上;核心 Runner 只看到 command、退出码与证据,不理解其中的领域语义。
- 检查实际状态优先于任何名字或 manifest;缓存命中必须由探测证明,不由「上次装过」推断。
- 参数按动作命名、纯数据化;内置命令的 identity 由参数构成,直接进入 carry 与复用池的现有规则。

## 需求

1. `--dry` 对复用 Experiment 逐命令展示预期成本类别:检查命中、每题重新执行,或 template 预制已守护。
2. 源码 checkout 有官方写法:identity 由 repo 与 ref 构成;复用周期内第二条 Attempt 起不再访问网络;泄漏检查边界不变。
3. 工具安装有官方 installTool 写法:探测、缺失时安装、安装后复检一次成型;identity 变化使命中失效。
4. 不新增执行频次、window scope 或按配对的守护表;内置命令的缓存只能放在 workdir 外,并服从 reset 与活状态边界。
5. fixture 物料沿用 `registerSandboxContent()` / `putContent()`,不建平行 API。
6. 采纳官方 checkout 命令 的候选必须显式翻案 memory 旧裁决,并登记新理由;不静默绕过。

## 不是本 doc 的目标

- 不改变 workdir reset、复用池键与活状态边界。
- 不做跨 Provider 的周期内快照或恢复原语。
- 不自动推导命令依赖或并行调度。
- 不把 Agent 安装(AgentProvisioner)并入普通工具。
