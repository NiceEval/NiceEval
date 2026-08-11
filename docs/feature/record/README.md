# Record：只保存已经发布的运行事实

Record 是 `<project>/.niceeval/record/` 中可携带、可进入 Git 的运行事实集。它保存已经写完并带有完成标识的 Run、这些 Run 的导航关系，以及 producer 写入的具名 `RecordAttachment`。

没有完成标识的 Run 目录不是 Record 事实。reader 不读取、不展示也不复用它，只返回 `incomplete-run` warning；用户可以用 `niceeval clean` 删除。

Record 不保存 session、锁或 cache。它也不保存作者 API、matcher、执行顺序、沿用算法、分析算法或页面模型。

“只保存事实”不表示内容一定正确，也不表示事实不能由运行时计算产生。Verdict、Score 与 Eligibility 都可以是已发布事实。判据是：它是否描述当时发生或决定的结果，离线复核是否需要它，以及它是否有明确 owner 和 schema identity。

## 新模型

```text
Assert-first API / Plugin / 执行与沿用算法 / Reports
                         经常变化，不进入 Record Core
                                      │
                                      ▼
RecordAttachment projector      形成 typed view
RecordAttachment schema         冻结一份 payload 的 shape 与语义
Record Core                     冻结身份、导航、分母和精确引用
                                      │
                                      ▼
.niceeval/record/               portable，可进 Git

.niceeval-local/                session、锁与 cache
                                不属于 Record，不进 Git，不分享
```

四层分别演进：

| 变化 | 动作 | 不需要变化的层 |
|---|---|---|
| 作者 API、matcher 或算法重构，持久语义相同 | 不改磁盘；可观察行为变化时更新 behavior identity | Record Core 与 RecordAttachment schema |
| 同一 RecordAttachment 的 payload shape 或语义改变 | 发布相邻 schema 版本，并声明 converter 或不可无损迁移 | Record Core |
| typed view 的形状或语义改变 | 发布新的 projector/API | 已保存的 RecordAttachment 与 Record Core |
| owner、引用、目录或 Core 形状改变 | 发布新的 `niceeval.record/vN`，提供相邻 converter | 业务 RecordAttachment 的事实含义 |

这里没有万能 schema。Record v1 Core 也不承诺永远不变；它只在 v1 内保持同一含义。未来改变 Core 时使用显式 migration，而不是让同一个 identity 改变解释。

## Assert-first 为什么不要求修改 Record

Assert-first 是 NiceEval 的长期作者模型。Record 保存规范化的 AssertionResult，不保存 matcher 对象、作者调用顺序或 evaluator 的运行时对象。

Assertion evaluator、Plugin 生命周期或聚合实现可以独立变化。只要已发布事实的语义不变，Record bytes 就不变。

`pass | score` 属于 Run-owned Evaluation RecordAttachment。两类 Eval 的 Attempt 都保存四态 Verdict；Score Eval 另存 Score。它们都不进入 Core。

## 当前格式专用读取

普通 `show`、`view`、`exp --dry` 和 `exp` 只打开当前 Record major。已知旧 major 返回 `record-migration-required`，并提示：

```sh
niceeval migrate
```

已知旧 RecordAttachment 只影响请求它的功能。完整相邻 converter 链返回 `migration-required`；路径遇到 `not-losslessly-migratable` 返回 `migration-unavailable`。其它 Core 与 RecordAttachment 继续可读。

未知 RecordAttachment 保留原 bytes，并始终返回 unsupported。

`niceeval migrate` 原地执行相邻版本链，保持仍表示同一事实的 `recordId`、RunId、SlotId 与 AttemptId。迁移前检查 `.niceeval/record` 已完整保存在当前 Git commit；无法证明时要求用户显式确认。Git 或用户备份提供恢复点，Record 不另存副本或迁移历史。

## 能力边界

`RecordReader` 在 Effect Scope 内冻结一次可读视图。`RecordWriteSession` 取得 writer lock；一个 writer 写完 Run 的所有内容后，最后创建完成标识。

reader 可以与 writer 并发，因为没有完成标识的目录不是 Run。migration 改写既有事实，因此取得独占 maintenance lock，并与 reader、writer 互斥。

Record v1 只定义 exact JSON RecordAttachment 与 owner-local blob closure。内部 Stream 只扫描 Run 或处理 blob I/O，不进入 RecordAttachment、Sample 或 Report 的公开值。

`EvaluationRecordContract` 在调用 generic writer 前验证 Evaluation 领域事实。generic writer 只验证 Core、owner、typed RecordAttachment、closure 与精确引用。

## 文档入口

- [Architecture](architecture.md) —— Core、RecordAttachment、完成标识、锁和 migration 不变量。
- [Library](library.md) —— Effect API、reader、writer、typed projection 与 migration definition。
- [CLI](cli.md) —— `show`、`view`、`exp`、`clean` 与 `migrate`。
- [发布完整 Run](use-case/发布完整运行.md) —— producer 怎样写入并留下完成标识。
- [上层变化如何停在上层](use-case/上层变化不改持久格式.md) —— Assert-first 与算法边界。
- [选择正确的演进边界](use-case/未来功能不扩张核心格式.md) —— RecordAttachment、projector 与 Record major 的选择规则。
