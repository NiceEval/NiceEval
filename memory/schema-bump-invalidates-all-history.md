# 升 schemaVersion 会把存量语料整批打成不可携带

## 现象

`RECORD_SCHEMA_VERSION` 一动,`.niceeval/` 里所有旧版本快照整份读不进来:
`openRecord` 把它们放进 `unreadable`,携带规划拿不到任何 `priorResults`,
下一次 `niceeval exp ... --dry` 的每一格都要重跑。

在 MemoryBench 这种攒了几十次真实运行的语料库上,一次升版 = 一次全量重跑的账单。
升版当时看不见这笔代价:仓库自己的 fixture 都是当场写当场读,永远同版本。

## 根因

Record 契约明确**不做兼容机制**:没有迁移函数,没有多版本 normalize loader,
版本不同就是不兼容([字段规则与版本不匹配时的读取行为](../docs/feature/record/architecture.md#版本不匹配时的读取行为))。
这条设计的代价全部压在「什么时候允许递增」上,所以同一段契约把判据写死了:

> `schemaVersion` 用整数,只在**破坏兼容读取**时递增。
> 新增可选字段、新增 artifact 文件、新增 `StreamEvent` variant 不递增;
> 读取器必须忽略未知字段和未知 artifact 文件。

于是加字段的改动搭升版的车、或者「这一批改得比较大,顺手升一位」,都是把全量重跑的账
转嫁给用户,而类型系统与测试都不会红。

## 修法

**递增前逐条过一遍这一批的 record 面改动,只有满足下面任一条才升版:**

- 字段被删除、改名或改变类型(旧 reader 读它会拿到 undefined 或读错语义);
- 判别联合换了判别方式(旧 reader 的穷尽分支落不到任何一支);
- 同一字段的含义被重定义(形状没变,读出来的结论变了)。

纯增量——新增可选字段、新增旁文件、删掉一个只有本仓库读的 flag——一律不升版,
两个方向都靠「忠实磁盘、忽略未知字段」兜住。

2026-07-30 按这条判据复核过 `13`:
本轮的 `carriedAccepting`、`error.timeout`、`manifests.json` 旁文件、`carriedIgnoringFlags`
移除确实都是纯增量,但同一个 commit(`63877700`)里另有两处形状改写——
`TimingNode`(封闭 `kind`)整体改成开放 key 的 `TimingActivity`,
`AttemptError.phase` / `DiagnosticRecord.phase` 改成 `origin: TimingOrigin` 判别联合。
消费侧已经在按新形状读(`entity-lists/compute.ts` 直接取 `result.error.origin.scope`),
旧落盘喂进去读不出任何东西。**这一版是真破坏兼容,不回滚。**

代价那一半另有出口:跨版本的历史现在在 `--dry` 里标 `incompatible` 而不是 `new`
(见 `--dry` 的[门级词表](../docs/feature/experiments/cli.md#--dry计划矩阵与作废原因)),
至少让人看得出「这批不是没跑过,是这个 CLI 读不动」。
