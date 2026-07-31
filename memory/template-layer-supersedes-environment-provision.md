# 单 template + 统一 Layer 取代 Environment / Provision 二分

**已被后续裁决替代**:同日复审发现统一 Layer 会弱化真实检查、丢失完整 Sandbox Case 与 Agent Ensure 义务。
后续先选择完整 Sandbox Case + Experiment Addon + 独立 AgentProvisioner,最终采用三份 Requirement + 唯一 Base Case + Ensure。
最终裁决见 [requirements-base-case-ensure](requirements-base-case-ensure.md)。

## 当时的裁决

2026-07-31,环境模型一度改为「一个 template 槽位 + 一组 Layer 并行安装」。

- 第一目标是减少概念数、样板行数与「写在哪」的判断次数。
- Eval environment 或 Experiment template 提供唯一起点;双声明走按 profile 映射的 `templates` 表。
- Experiment 工具、Eval 附加条件与 Agent CLI 统一为 `defineLayer`。
- Layer 默认并行,依赖或共享包管理器的内容要求作者合并。
- install 后由框架写受管 manifest,同 identity 直接命中;`inspect` 只作为逃生路径。

## 为什么继续改判

复审把方案放回已经定稿的 Sandbox Case、Agent Ensure 与缓存契约后,发现四个结构性问题:

- template 不能表达 Compose 的多 service、网络、ready、主执行空间、能力与整组清理。
- manifest 只能证明曾经安装,不能证明当前二进制、PATH、权限与运行条件仍正确。
- Agent 安装还承担 staged payload、平台探测、三种安装模式和 Attempt 安装事实,不能无损缩成普通 Layer。
- Adapter 内部 Layer 与用户 Layer 可能争用同一包管理器,但两个所有者无法按要求合并实现。

因此「统一协议减少负担」只保留在普通 Experiment 工具范围。
最终方案以 Addon helper 降低样板,以资源互斥和依赖 DAG 代替默认全并行。
