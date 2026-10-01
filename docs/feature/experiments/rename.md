# 实验改名与明确采用

Experiment ID 由 `experiments/` 下的路径决定。删除或改名只改变当前项目的实验集合；历史 Run 与 Attempt 保持可读。
`niceeval exp rename` 把明确选择的历史 Run 采用到一个当前 Experiment。命令建立新的 Run，以 `accepted` reference Member 引用原 Attempt；不移动实验文件，也不复制或改写执行事实。

## 命令

```sh
niceeval exp rename compare/new --run 8f3d6f62-1d34-4cf3-99c7-84ba3c483706 --dry
niceeval exp rename compare/new --run 8f3d6f62-1d34-4cf3-99c7-84ba3c483706
niceeval exp rename compare/new --run 8f3d6f62-1d34-4cf3-99c7-84ba3c483706 --json
```

唯一位置参数是当前目标 Experiment 的 exact ID；`--run` 必填且只接受一个 exact source Run ID。
旧 Experiment ID 从该 Run 读取，不由用户重复提供，也不要求旧实验定义仍在项目中。
命令不推断最新 Run，不合并多轮结果，不接受逐 Attempt selector。source 与 target ID 相同时引导使用 `accept --run`。

`--dry` 与正式调用使用同一预检。预览展示 source Run、旧名、目标名，以及每个 Eval、ordinal 和 exact source locator。
正式调用重新求值一次当前目标，在同一冻结输入与 cutoff 下完成预检和发布；它不把之前的预览当成仍然有效的授权证明。

## 整批范围与资格

把 source Run 的 Experiment ID 映射为目标 ID 后，两端 `(evalId, attemptOrdinal)` 必须双向全等。
每个 source slot 必须有唯一且合格的已发布 Attempt，每个目标 slot 必须恰好对应一次。缺失、重复、多余、悬空或不合格的成员都阻断整批，预检失败零业务写入。
不会通过排除成员、只取交集或补空 slot 来成功完成采用。source Run 可以仍为 active，只要 cutoff 下所选成员已完整发布。

目标必须当前可发现并可求值。`errored`、`skipped`、不完整的评分或缺失的必要证据不能被采用；真实执行时长必须符合当前 timeout。
完整资格由[缓存与采用](cache.md#显式采用的资格)拥有，rename 不提供强制通过开关。

目标已有结果不阻止明确采用。成功发布的新 Run 参与当前结果选择，原目标历史仍可由 Run 或 locator 查看。
预览与正式反馈都说明：采用会为目标发布一批新的当前成员。进入发布后的失败或中断遵守 Run 收口与 receipt 契约，不声称已发布部分仍然零写入。

## 纯改名的有限等价

Experiment 归属变化不代表任务或条件变化，但持久 execution digest 可能编码实验身份。
`experiment-rename/v1` 只允许第一方明确拥有的实验归属字段发生变化，不改变既有 identity 算法或历史字节。

一次当前目标求值捕获完整的 fingerprint 计算原料。各 owner 只把自己声明的 Experiment 归属字段映射为 origin Experiment ID，再用原算法纯计算 fingerprint 与 combined execution digest；结果必须逐字等于 exact origin 的 digest。
重建不再次 import、读文件、执行定义函数或调用 Provider，也不替换任意同名文本。

Eval、ordinal、任务、flags、模型、Judge、判据、timeout 与其它运行输入保持当前值；不能从历史回填来制造匹配。
无法证明闭包、识别算法域或重建 opaque Provider / Plugin 输入时，明确拒绝。其它输入变化按其具名有限采用规则独立判断，不能借改名绕过。

源 Run 与 origin Run 的[执行上下文](../run/architecture.md#实验-hook-声明)必须明确声明没有 opaque Experiment hook。
历史缺少声明时保留 unknown 并拒绝，不能从缺失活动推断；新 reference Run 也不能替 origin 补造证明。

source Run 与 origin Run 分别校验：选中的 Member 可能引用更早的 Attempt，旧实验名不能代替真实 origin。
跨 Run 按逻辑位置和受证明的 digest 判断，slot ID 只负责各自 Run 内的精确引用，不要求不同 Run 的 slot ID 相等。

## 写入与持续沿用

正式执行建立 Invocation 和目标 Run，以 `accepted` reference Member 引用原 `{ originRunId, attemptId }`。
原 Attempt 的 origin、locator、Core outcome、Assertions 与采集事实不变；receipt 给出新 Run 和被采用的 source locators。

后续 carry 复用同一纯重建判据，并要求 cutoff 内存在匹配目标逻辑位置、target digest 和 exact origin 的 `accepted` Member。
见证的 binding publication revision 不晚于当前 source Member；不能用启动时间推断先后，也不能让 `carried` action 自证等价。
唯一见证删除、不可读、缺少可证明的 publication 顺序，或目标再次改变时形成具名 gap，不回退选择更旧 source。

## 输出与错误

机器输出交付预览或发布结果，包含 `sourceRunId`、派生的 `oldId`、`newId` 和逐成员 source locator。
失败保留具名原因与具体说明；不能把 identity 不匹配折成source Run 不存在，也不能输出要求删除目标历史的建议。

| 情况 | 行为 |
|---|---|
| 缺少或重复 `--run`、位置参数不合法 | 用法错误，显示完整命令形状 |
| exact source Run 不存在或不可读 | 拒绝，并保留 source Run ID |
| 目标未发现、等于 source或求值失败 | 拒绝，说明目标条件 |
| source 与 target 范围不闭合 | 拒绝整批，列明位置与原因 |
| identity、质量或证据资格不合格 | 拒绝整批，保留阻断依据 |

## 与 carry 和 accept 的边界

| 动作 | Experiment identity | 采用条件 | Core relation / action |
|---|---|---|---|
| carry | 不变 | 当前 identity 与证据资格满足 | `reference / carried` |
| accept | 不变 | 人明确选择合格 Attempt 或完整 Run | `reference / accepted` |
| rename | 改变 | 人明确选择完整 source Run 与当前目标 | `reference / accepted` |

使用路径见[审阅后采用历史结果](use-case/cache-adopt-migrated-config.md)。
