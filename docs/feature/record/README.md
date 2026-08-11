# Record：只保存已经发布的事实

Record 是 `<project>/.niceeval/record/` 中可携带的持久事实集。它只包含 complete 且已原子发布的 Run（`completedAt` 必填）、这些 Run 的导航关系，以及 producer 写入的具名 Channel。

Record 不保存 session、锁、迁移现场或 cache。它也不保存作者 API、matcher、执行顺序、沿用算法、分析算法或页面模型。

“只保存事实”不表示 payload 一定正确。Record 保证的是 owner、identity、shape、引用和发布时间边界。业务内容是否可信，仍由对应 Channel 的领域契约解释。

## 新模型

```text
Assert-first API / Plugin / 执行与沿用算法 / Reports
                         经常变化，不进入 Record
                                      │
                                      ▼
Channel projector              形成具名的 typed view
Channel schema                 冻结一份 payload 的 bytes 与语义
Record Core                    冻结身份、导航、分母、引用和发布单位
                                      │
                                      ▼
.niceeval/record/              portable、immutable、可进 Git

.niceeval-local/               session manifest、锁、恢复现场（control）
                               不属于 Record，不进 Git，不分享
.niceeval-staging/             sealed Run payload、migration N/O
                               target-volume private sibling，不进 Git
```

四层各自拥有版本出口：

| 变化 | 动作 | 不需要变化的层 |
|---|---|---|
| 作者 API、matcher 或算法重构，持久语义相同 | 不改磁盘；可观察行为变化时更新 behavior identity | Record Core、Channel schema、Channel projector |
| 同一事实的 payload shape 或语义改变 | 发布新的 `RecordChannelSchemaId` | Record Core |
| typed view 的形状或语义改变 | 发布新的 projector export / Library API | 旧 payload 与 Record Core |
| owner、引用、目录或原子发布公理改变 | 发布新的 `niceeval.record/vN`，再显式迁移 | 旧 Channel payload 的事实内容 |

这里没有一个万能 schema。稳定来自每层只承诺自己的 identity，变化则在所属层发布新 identity。

## Assert-first 为什么不要求修改 Record

Assert-first 是 NiceEval 的作者模型。Record 保存 `niceeval.assertions/v1` 的规范化 AssertionResult，不保存 matcher 对象、作者调用顺序或 evaluator 的运行时对象。

Assertion evaluator、Plugin 生命周期或聚合实现可以独立变化。只要持久语义不变，Record bytes 契约就不变。

`pass | score` 是 `niceeval.evaluations/v1` 的闭合分支。评估类型属于 Run-owned Channel，不进入 Core。

## 当前格式专用读取

普通 `show`、`view`、`exp --dry` 和 `exp` 只打开当前 Record major。遇到已知旧 major 时，命令返回 `record-migration-required`，并提示执行：

```sh
niceeval migrate
```

NiceEval 不提供旧 major 的兼容读取模式，也不在普通 open 时自动迁移。`niceeval migrate` 原地更新同一个 root，并保留 `recordId`、RunId、SlotId 与 AttemptId。

迁移没有产品内回滚命令，也不保留 durable migration history。需要回退时由用户使用 Git 或自己的备份。

## 能力边界

`RecordReader` 取得共享 maintenance lease，并冻结一次候选视图。`RecordWriteSession` 在共享 maintenance lease 之上取得独占 writer lock，再形成和发布完整 Run。

`niceeval migrate` 取得 exclusive maintenance lease，因此迁移期间没有 reader 或 writer。reader 不取得 writer lock，但在 Scope 内持有 shared maintenance lease。

## 文档入口

- [Architecture](architecture.md) —— 落盘形状、Channel、锁、发布和迁移不变量。
- [Library](library.md) —— Effect API、reader、writer、projector 与 typed errors。
- [CLI](cli.md) —— `show`、`view`、`exp`、恢复与 `migrate`。
- [发布完整 Run](use-case/发布完整运行.md) —— producer 怎样形成并发布一个 Run。
- [上层变化如何停在上层](use-case/上层变化不改持久格式.md) —— Assert-first 与算法边界。
- [选择正确的演进边界](use-case/未来功能不扩张核心格式.md) —— Channel、projector 与 Record major 的选择规则。
