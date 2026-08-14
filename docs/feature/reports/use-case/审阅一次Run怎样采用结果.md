# 审阅一次 Run 怎样采用结果

这个用例回答两个不同的问题：一个 Run 为什么包含某个结果，以及这个 immutable Attempt 有哪些业务事实。前者属于 Run membership，后者属于 Attempt；不能只看 locator 或只看最近一次运行来代替。

## 1. 取得 Run ID

普通 `exp` 的机器调用从最后一条 receipt 读取 `runIds`：

```json
{"type":"receipt","receipt":{"invocationId":"11c8fc15-8a9b-49a0-bb93-68205b52ffab","runIds":["7b8d2ea4-b840-4870-9840-f85a436a5527"],"startedAt":"2026-08-14T10:00:00.000Z","completedAt":"2026-08-14T10:01:00.000Z","completion":"completed"}}
```

TTY 完成反馈也显示 Run ID。`niceeval accept @<AttemptId>` 会建立一个新的 Run，并在成功反馈中显示新 Run ID 与保持不变的结果 locator：

```text
Accepted source Attempt @91ddc61b-ae96-4a23-8578-ddc1b83306dc into new Run 7b8d2ea4-b840-4870-9840-f85a436a5527. Result locator remains @91ddc61b-ae96-4a23-8578-ddc1b83306dc.
```

`accept` 的这行反馈供操作者复制，不是 JSON receipt 或稳定正则协议。

## 2. 审阅 Run membership

```sh
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --json
```

没有显式 `--report` 时，`show --run` 使用内建 `run-membership-overview`。在目标 row 中核对：

- `slotState: included`：这个 Run 的分母中有可读 Member。
- `memberRelation: reference`：Member 指向别的 origin Run 中的 Attempt。
- `sourceAttemptLocator`：继续下钻时使用的同一个 immutable Attempt locator。
- `membershipOutcome: accepted`：这个 Run 的 provenance 说明本轮是人工采用；它不持续证明该 Attempt 适合未来 Run。
- `verdict: passed`：Verdict 从源 Attempt 读取，没有复制进采用 Run。

多次执行可能得到相同 Verdict，但 Run 仍不等价。每个 Run 有自己的 expected-slot 分母、Core Member 与 membership provenance；`executed`、`carried`、`accepted` 回答的是本轮怎样形成，而不是 Attempt 内容是否变化。

## 3. 下钻 immutable Attempt

```sh
niceeval show @91ddc61b-ae96-4a23-8578-ddc1b83306dc
niceeval show @91ddc61b-ae96-4a23-8578-ddc1b83306dc --execution
```

第一个命令读取 Attempt identity、四态 Verdict、Assertions 与适用的 Score；第二个命令读取 execution evidence。两个命令都不会回答另一个 Run 为什么采用它，因为 adoption 属于目标 Run 的 membership provenance。

内建 Run 表是 bounded summary。已知 locator 时用 `show @locator` 精确下钻；需要超过内建表界限的其它 Run 字段时，使用显式自定义 Report。
