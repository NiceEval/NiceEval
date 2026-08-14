# 审阅一次 Run 的闭合结果

这个用例把固定 Run 的选择事实与 immutable Attempt 的已关闭 Evidence 分开阅读。前者说明 Sample 的分母和 Slot 坐标；后者从 exact locator 下钻。Report 不建立第三份持久状态，也不从一类事实猜出另一类事实。

## 1. 取得 Run ID

普通 `exp` 的机器调用从最后一条 receipt 读取 `runIds`：

```json
{"type":"receipt","receipt":{"invocationId":"11c8fc15-8a9b-49a0-bb93-68205b52ffab","runIds":["7b8d2ea4-b840-4870-9840-f85a436a5527"],"startedAt":"2026-08-14T10:00:00.000Z","completedAt":"2026-08-14T10:01:00.000Z","completion":"completed"}}
```

TTY 完成反馈也显示 Run ID。`niceeval accept @<AttemptId>` 会建立一个新的 Run，并在成功反馈中显示新 Run ID；机器调用仍应读取 receipt，不应匹配人读句子。

## 2. 核对固定 Sample

```sh
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --json
```

没有显式 `--report` 时，`show --run` 使用有界 `run-membership-overview`。在目标 row 中核对：

- `runId` 与 `slotId`：这个 row 的稳定坐标；
- `slotState`：该 Slot 在固定 Sample 中的 Core 状态；
- `memberAction`：Core 提供的动作，缺失时保持缺失；
- `memberRelation` 与 `sourceAttemptLocator`：只有 included Slot 才提供的 origin/reference 关系和下钻定位符；
- `evidenceState`：同一 Sample 中已关闭 Evidence 视图的可用性。

这些字段不形成额外的 Report 持久化对象。每个 Run 仍拥有自己的 expected-slot 分母和 coverage。表最多显示 200 rows；需要其它字段或更大切片时，使用显式自定义 Report。

## 3. 下钻 immutable Attempt

```sh
niceeval show @91ddc61b-ae96-4a23-8578-ddc1b83306dc
niceeval show @91ddc61b-ae96-4a23-8578-ddc1b83306dc --execution
```

第一个命令使用 `attempt-overview`，显示精确 Attempt 的 identity 与完整 MetricValue。第二个命令选择 execution Report，显示关闭的 observability Evidence。两条命令都从各自的 ReportExecution 读取，不会重新打开 Record 或改变固定 Sample 的分母。

已知 locator 时应使用 `show @locator` 精确下钻。静态站、terminal 和 Web 都读取同一份闭合树，因此 locator、Evidence refs、issues、samples 和 total 可以在任一呈现面复核。
