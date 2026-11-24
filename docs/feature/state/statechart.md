# State checkpoint 的状态

一次 Attempt 结束时，State 把每个目录的检查点先写进暂存，再在一个事务里推进全部 HEAD 并记录 `saved`。进程可能在提交前被杀，也可能在提交后、收到回执前被杀；恢复者与后继随后接手。这一页用模型检查器核对[State 架构](architecture.md)与[数据模型](data-model.md)的提交与恢复规则。

## 规则

### 全组一起提交 {#NoHalfCommit}

两个目录的检查点一起可恢复，`saved` 记录与检查点同时可见，不出现只推进了一个目录的状态。

### 检查点身份不复用 {#CheckpointIdNoABA}

即使内容相同，新的保存也有新的检查点身份，下一次恢复的起点不会倒退到旧身份。

### 失权的运行不能推进 {#NoLateCommit}

失去保存资格的原运行，即使请求迟到，也不能再推进恢复起点。

### 中断后最终确定 {#SettlesAfterCrash}

数据库可读、合法的恢复继续时，未决的保存最终确定为已保存，或确认未保存并记录 `skipped/recovered`。

## 模型

```statechart spec="./tla/checkpoint/Checkpoint.tla" config="./tla/checkpoint/after.cfg" view="./tla/checkpoint/view.ts" out="./tla/checkpoint/out/after" digest="sha256:05ef6b409c980a8b2d044be1dae611e64be21ed58f158b219abfe3b87997bea1"
```

两个目录、三个依次取得同一租约的执行、一次提交前中断与一次提交后丢回执。四条规则都成立。去掉“原运行已失权”这一条件的变体会在 5 步打破 `NoLateCommit`，说明模型能发现这类错误。

租约与 Run writer 合并为一个“有保存资格”的条件；原进程中断、终止得到证实与恢复者取得资格合为一步。图合并各轮执行与不同的检查点身份，不画拒绝迟到写入。

## 按路径重放的测试

`test/process/state-checkpoint.test.ts` 在两个真实中断点结束 CLI 进程：提交前被杀时保留原起点，恢复后为 `skipped/recovered`；提交完成、回执未到时被杀时保留 `saved`，后继从这个检查点恢复。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 动作 | 代码 |
| --- | --- |
| 冻结起点、暂存检查点 | `state/execution.ts`；`record/sqlite/state-repository.ts` |
| 一次事务推进 HEAD 并记录 saved | `record/sqlite/storage-worker.ts`；`record/sqlite/transaction.ts`；`record/sqlite/state-repository.ts` |
| 中断、恢复者取得资格、拒绝旧写 | `run/storage/sqlite.ts`；`record/sqlite/state-lease-repository.ts` |
| 回执、丢回执后按 executionId 重读 | `state/execution.ts`；`record/sqlite/state-repository.ts` |
| 恢复与后继 | `experiment/host/teardown.ts`；`record/sqlite/state-repository.ts` |

## 模型没有覆盖的部分

归档格式、分块与哈希、路径校验、SQLite 忙与容量、归档失败、cleanup 与 after 的故障，以及数据库永久不可读或始终拿不到恢复证据的情形。
