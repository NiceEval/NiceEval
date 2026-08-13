# Eval Group —— CLI

Eval Group 不增加独立运行命令。`niceeval exp` 的 selector 仍按 Eval ID 选择；选中一条成员
不会隐式选中整个 Group。`--rerun`、`attempts`、carry、预算和首过即停继续作用于实际 slot。

## Dry plan

普通 `niceeval exp <selector> --dry` 在每个矩阵项显示 `evalGroupId`。Group 身份来自
`evals/**/eval-group.ts` 的目录路径；输出不公开作者数组 index，也不从 index 推导顺序。

`--dry --commands` 的 `commandPlan` 使用一条 `eval-group` lane 表达整个 Group：

- lane id 是规范化 Group ID；
- ordering 是 `serial-normalized-eval-id`；
- slot 先按规范化 Eval ID、再按 Attempt index 排列；
- carried slot 固定没有命令，也不进入物理 lifecycle；
- shared lifecycle 是每台实际物理实例的条件模板，不承诺整场只执行一次。

不同 lane 之间没有全局序号。Group lane 的严格串行不限制其它 Group 或普通 Eval 使用并发位。
机器形状与 schema version 的唯一契约见
[Experiments · CLI](../../feature/experiments/cli.md#drycommands命令计划)。

## 运行反馈

运行进度、结果与错误仍以 `(experimentId, evalId, attempt)` 标识 Attempt。Group ID 是附加的
调度与诊断上下文，不替代 Eval ID。Sandbox 无法继续时，反馈必须点名 Group、失败阶段和
`onUnavailable` 的实际动作；停止后续 slot 不伪造结果。
