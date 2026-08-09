# 实验改名与 Run 采用

Experiment ID 由 `experiments/` 下的路径决定。
改名会产生新的 `experimentId`；旧 Run 仍是原来的 graph entity，不会被路径改写、移动或删除。

`niceeval exp rename` 让操作者明确采用旧 Experiment 的已有 Attempt。
它不复制执行事实，也不把 Attempt 改挂到新 Experiment；目标只建立新 Run、rename Claim 与 `mode: "renamed"` Contribution。

## 命令

```sh
niceeval exp rename codex codex-5.6 --dry
niceeval exp rename codex codex-5.6
niceeval exp rename codex codex-5.6 --json
```

命令只支持一个旧 ID 到一个新 ID。
旧 ID 从一个明确的已提交 `RecordGraphRef` 读取；新 ID 必须由当前项目的 Experiment discovery 找到。
`--dry` 与正式执行使用相同预检，前者不写 Record。

## 预检与范围

rename 先完成整批预检，任一不合格项都会让命令在写入前失败。

1. `oldId` 与 `newId` 必须不同。
2. source Graph 中必须有 oldId 的可读、终态 Attempt。
3. newId 必须是当前可发现的 Experiment，且当前选择规则仍选择该 Eval。
4. 当前配置、Sandbox pair 与 timeout 资格必须可以求值。
5. 每个 source membership 在目标 Run 中只能被选择一次。

`errored` 与 `skipped` 不能 rename。
不再被 newId 选择的 Eval 会在 `--dry` 中列为 excluded，不会被自动加入，也不会扩大本次授权。

预检锁定 source Graph、source Contribution、Attempt revision 与 target configuration。
它不会按目录、时间或可变 head 隐式选择一次执行，也不会把多个历史 Run 隐式拼成 source。

## 写入语义

正式执行建立一个新的 Invocation，并为 `newId` 建立一个 Run。
对每个通过预检的成员，Runner 写入：

1. rename Claim，说明 oldId、newId、被采用 Contribution 与 Attempt ref、当前配置身份和审计依据；
2. `mode: "renamed"` 的 RunContribution，其 `basisClaims` 指向该 Claim；
3. Run 的 immutable `RecordGraphRef` 与对应 receipt。

Contribution 采用 source Attempt 的明确 revision。
`originRunId`、AttemptId、locator、Verdict、Observation、evidence 与 Provenance 都不变；新的 Run 只拥有自己的 `membershipSlot`、Claim 与 Contribution。

Claim 使用 Record 的通用 `ClaimPayloadV1`，不定义专用迁移结果接口或复制后的出处字段。
后续读取根据 Contribution 的 `mode` 与 `basisClaims` 解释采用理由。

如果迟到事实让 source Attempt 出现后继 revision，目标 Contribution 只能沿同一 Attempt 的线性链前进。
它不能借 rename 换 locator、换 origin Run 或换成另一个 Attempt。

## 输出与错误

成功输出列出 source locator、oldId、newId、`renamed` mode、目标 Run 和 GraphRef。
source locator 保持原样，例如：

```text
@01J8ZK3M6P4T7V9X2C5N8QW0RY  codex -> codex-5.6  renamed
```

`--json` 输出计划或终态 receipt，不另定义一套迁移结果 schema。
机器消费者通过 receipt 的 GraphRef 与 Record 的 `RunContributionHandle` 读取完整证据。

| 错误 | 条件 | 下一步 |
|---|---|---|
| `rename-source-empty` | source Graph 没有可采用成员 | 检查 oldId 或选择正确 RecordGraphRef |
| `rename-target-not-found` | newId 不是当前 Experiment | 恢复或指定目标 Experiment 文件 |
| `rename-ineligible` | Eval 不再被选择，或配置、timeout、计划不满足条件 | 查看 `--dry` 的具名原因 |
| `duplicate-rename-member` | 同一目标 membership 被重复选择 | 收窄 source 或只保留一个成员 |
| `record-head-conflict` | Store 提交遇到新的 head | 基于 returned actual head 重建并重试 |

Record 写入失败时，receipt 必须如实表达 `partial` 或 `not-recorded`。
它不能宣称 rename 已完成，也不能补造一个可读取的 GraphRef。

## 与 carry 和 accept 的边界

| 动作 | Experiment identity | 采用条件 | Contribution mode |
|---|---|---|---|
| carry | 不变 | 指纹与资格自动满足 | `carried` |
| accept | 不变 | 人明确接受当前配置下的具体 Attempt | `accepted` |
| rename | 改变 | 人明确采用旧 Experiment 的具体 Attempt | `renamed` |

三种动作都创建 Claim 与 RunContribution，并保留同一个 Attempt identity。
它们不复制事实、不开第二个 RecordStore，也不改变 Sample 的固定 GraphRef 选择规则。

## 验收

1. 文件从 `codex.ts` 改为 `codex-5.6.ts` 后，`--dry` 只列出明确 source Graph 中可采用的成员。
2. 正式 rename 产生新 Run、Claim 与 `renamed` Contribution，但 locator 仍是 source Attempt 的完整 locator。
3. 旧 Run 与旧 Experiment 的历史 GraphRef 始终可读；目标 Run 的 Sample 成员通过 Contribution 指向同一 Attempt revision。
4. `--dry` 零写入；`--json` 不混入人读文本，也不要求消费者拼接路径或复制字段。
