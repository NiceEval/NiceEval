# Compose caseIdentity 含本地镜像 digest,并行 docker 活动导致指纹抖动

**现象**(2026-08-04,terminal-bench 迁移后 accept 流程):对 12 个 Compose 题 `niceeval accept` 重锚后立即 `--dry`,同一批题反复回到 `stale passed`,原因恒为 `plan:physical changed`;单独 accept 后立刻 dry 有时稳定有时又抖。期间宿主机上另有 agent 在做 docker 构建/拉取。

**根因**:Compose 的 physical planning(`collectComposeBuilds`)把 service 镜像的本地解析 digest(imageRefs)收进 caseIdentity;本机镜像状态被并行构建改变时,两次规划之间指纹漂移,accept 刚锚定的 fingerprint 立即失效。

**修法(候选上游修正,未实现)**:digest 解析应钉在声明(镜像 ref 写明 digest 时用声明值)或同一 Invocation 的首次解析结果上,不随本地 daemon 状态逐次重采;至少 `--dry` 与 `accept` 应消费同一次规划快照。

**临时处置**:accept 完立即启动 run(run 以启动时刻规划为准);个别又抖掉的题接受重跑。
