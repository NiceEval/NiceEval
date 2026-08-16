# 审阅一次 Run 的闭合结果

这个用例把固定 Run 的选择事实与 immutable Attempt 的关闭 Evidence、Observability 和 File Changes 分开阅读。前者
说明 Sample 的分母和 Slot 坐标；后者由已生成的详情 Page 下钻。Report 不建立第三份持久状态，也不从一类事实猜出另一类事实。

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
niceeval show @1K1P0VJAPVJ12
niceeval show @1K1P0VJAPVJ12 --json
```

第一个命令使用选中的内建 Page，显示精确 Attempt 的 identity、完整 `MetricValue` 与该 Page 声明的关闭领域数据。
第二个命令输出同一个单目标的内建机器文档。每条命令都只执行被选择的 Page；输出阶段不会重新打开 Record 或改变该 Sample 的分母。

已知 locator 时应使用 `show @locator` 精确下钻。要读取自定义报告的另一页，显式传入该页的 `--page <route>`。view 与静态目录读取
同一份 `ClosedSiteRevision`；terminal 为目标 Page 生成临时 text。三种呈现面都保留同一 Sample 的 locator、Evidence refs、issues、samples 和 total。

Attempt 页的源码中，带交互标记的 `.send()` 行可以原生展开。展开区显示该次物理 send 的 Session log 摘要与事件轨迹；工具调用、工具结果和 assistant 消息保持原始因果顺序，不折成只有最终文本的一行。

## 4. 查看 File Changes 轨迹

`attempt-overview` 默认按 send 区间展示 File Changes trajectory 与 collection。它保留同一路径在不同 send 中的重复，
不会按 path 合并。例如 `turn1` 创建 `src/answer.ts`、`turn2` 修改它时，两个端点变化都应可见。

只有 Analysis 已证明端点连续、端点已知且 collection 完整时，overview 才把 reliable `net` 放进摘要或
`DiffView`（差异视图）。端点不连续、未知或 collection 为 partial 时，页面显示 `indeterminate` 与 issue，
并仍保留已经捕获的轨迹。

完整空轨迹表示完整采集到零个 agent 归因变化；partial 的空安全前缀不作此断言。`not-recorded` 则说明 collector
不适用于该 Attempt。`show` 在目标详情页取得这些闭合值；view 与静态目录在全站构建中取得它们，随后打开详情页不会再次读取。
