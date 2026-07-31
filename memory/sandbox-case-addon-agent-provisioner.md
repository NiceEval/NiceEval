# 完整 Sandbox Case、Experiment Addon 与 AgentProvisioner 分工

**已被后续裁决替代**:PLAN-4 把 Addon 保留为 Experiment Requirement helper,并允许 Eval 与 Experiment 任一侧提供 Base 或 Ensure。
最终裁决见 [requirements-base-case-ensure](requirements-base-case-ensure.md)。

## 裁决

2026-07-31,环境模型一度选择三个领域对象,当时定稿在 `docs/design/environment-model/` 的 PLAN-3。

- Sandbox Case 负责题目环境、完整资源组、CaseKey、证据与清理。
- Experiment Addon 负责实验工具的目标 identity、实际检查、安装与复检。
- AgentProvisioner 继续由 Adapter 拥有,负责 Agent staged payload、平台、安装模式与安装事实。
- Addon 默认使用保守安装资源而串行;显式资源互不冲突且依赖满足时自动并行。
- `dependsOn` 表达语义依赖,资源声明表达互斥,数组位置不表达顺序。
- 受管 manifest 只能作为有失效边界的检查 cache,不能代替实际检查。
- Addon 声明进入 configHash;按目标环境解析出的平台与 payload 身份进入逐 Eval fingerprint。

## 推翻了什么

本裁决推翻 [template-layer-supersedes-environment-provision](template-layer-supersedes-environment-provision.md) 的单 template 与统一 Layer 结论。
它也没有恢复更早的全价 Provision:普通工具改用更窄的 Addon,常见检查与安装由 helper 降低成本。

`environments` 表继续映射完整 Sandbox Case,因为预制产物替代的是整个 case,不是一个抽象 template 槽位。
普通 Provider 内建常见 source kind 的 materializer,因此写 Compose Eval 不要求用户重复注册转换器。

## 保留的不变量

- Eval 不选择 Provider。
- Agent、Eval 命令、文件操作与 diff 锚定唯一主 Sandbox。
- 预装只是检查命中的优化,不按 template 名或 manifest 直接受信。
- BuildKey、CaseKey、Agent 安装身份与 Addon 身份保持正交。
- Fixture、跨 Attempt 状态与外部共享服务不因都包含准备动作而并入 Addon。
