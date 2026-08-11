# 实验改名与明确采用

Experiment ID 由 `experiments/` 下的路径决定。改名会产生新的 `experimentId`；旧 Run 与 Attempt 保持原身份，不会被路径改写、移动或删除。

`niceeval exp rename` 让操作者明确采用旧 Experiment 的已有 Attempt。它不复制执行事实，也不把 Attempt 改挂到新 Experiment；它为新 Experiment 建立 Run，并用 `accepted` Member 引用原 Attempt。改名理由进入 Run 的 `niceeval.actions` 通道。

## 命令

```sh
niceeval exp rename codex codex-5.6 --dry
niceeval exp rename codex codex-5.6
niceeval exp rename codex codex-5.6 --json
```

命令只支持一个旧 ID 到一个新 ID。旧 ID 从操作者明确选择的 Run 读取；新 ID 必须由当前项目的 Experiment discovery 找到。`--dry` 与正式执行使用同一组预检，前者不写 Record。

## 预检与范围

rename 在写入前完成整批预检，任一不合格项都会让命令零写入：

1. `oldId` 与 `newId` 不同；
2. 选定 Run 中有 oldId 的可读、终态 Attempt；
3. newId 是当前可发现的 Experiment，且仍选择对应 Eval；
4. 当前配置、Sandbox pair 与 timeout 资格可以求值；
5. 每个源成员在目标 Run 中只被选择一次。

`errored` 与 `skipped` 不能被采用。不再被 newId 选择的 Eval 会在 `--dry` 中列为 excluded，不会被自动加入。命令不会按目录时间猜一次运行，也不会把多个 Run 拼成输入集合。

## 写入语义

正式执行建立新的 Invocation，并为 `newId` 建立一个 Run。每个通过预检的成员产生一个 `accepted` Member，引用原 `attemptId`；原 Attempt 的 origin、locator、Verdict 和采集事实都不复制。

oldId、newId、当前 identity、差异摘要与操作者采用理由写入目标 Run 的 `niceeval.actions/v1` 通道，并以 `slotId`、`attemptId` 关联。这个通道只解释当时的决定，不持续认证源 Attempt；源 Attempt 已随 origin Run immutable，后续事实变化只能发布新 Run。

## 输出与错误

成功输出列出 source locator、oldId、newId、目标 Run 和 `accepted`：

```text
@01J8ZK3M6P4T7V9X2C5N8QW0RY  codex -> codex-5.6  accepted
```

`--json` 输出计划或 Invocation receipt，不另定义迁移结果格式。

| 错误 | 条件 | 下一步 |
|---|---|---|
| `rename-source-empty` | 选定 Run 没有可采用成员 | 检查 oldId 或明确选择另一个 Run |
| `rename-target-not-found` | newId 不是当前 Experiment | 恢复或指定目标 Experiment 文件 |
| `rename-ineligible` | Eval、配置、timeout 或计划不满足条件 | 查看 `--dry` 的具名原因 |
| `duplicate-rename-member` | 同一目标 slot 被重复选择 | 收窄输入 Run |

## 与 carry 和 accept 的边界

| 动作 | Experiment identity | 采用条件 | Member |
|---|---|---|---|
| carry | 不变 | identity 与资格自动满足 | `carried` |
| accept | 不变 | 人明确接受具体 Attempt | `accepted` |
| rename | 改变 | 人明确采用旧 Experiment 的具体 Attempt | `accepted` |

三种动作都建立新的 Run membership，并保留同一个 Attempt identity。采用原因都进入 `niceeval.actions` 通道，而不是扩张 Member 核心。
