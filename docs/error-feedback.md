# Issue 与用户反馈

niceeval 把「发生了什么」与「应该怎样告诉用户」分开。写入时只记录可追溯的 error /
diagnostic observation;读取与选择时产生结构化 Issue;宿主或 Reports 的 policy 最后把 Issue
映射为面向当前读者的 Notice。

```text
.niceeval observation
        ↓ read / select
structured Issue
        ↓ Notice policy(locale, host, context)
user-facing Notice
```

这条边界让同一份记录可以在 CLI、静态网页、CI 和自有产品中重新解释,而不会把某个
版本的英文文案、严重度 policy 或修复命令冻结在 `.niceeval` 里。

**分开的是「事实」与「解释」,不是把解释也分散。** 解释有唯一产地 `NoticeCatalog`,
宿主只投影,不各写一份文案(见[Present: Notice](#present-notice))。

## 三层契约

### Write: observation

Record 只持久化运行时真正观察到的内容:

- `AttemptError` 是让 attempt 进入 `errored` 的唯一致命失败证据;`message` 保留为原始原因摘要。
- `DiagnosticRecord` 是不必改变 verdict 的运行 observation;只带 `code`、`level`、`phase`、
  `detail`、`context` 与 `count`。
- `detail` 只描述当时观察到的现象,`context` 保存支撑 code 的结构化依据。
- observation 不带本地化文案、修复建议、忽略条件或 `command`。

`DiagnosticRecord.level` 是写入方当时观察到的运行影响,不是最终 Notice 严重度,也不是
verdict 的别名。读取 policy 可以结合宿主、范围和其它事实上调或下调 Notice。

### Read: Issue

Issue 是从记录、artifact 可达性、诊断 observation 与 Sample 选择结果中派生的可重算结构。
它用稳定 code 表达类别,并携带定位与判断所需的原始事实。例如:

- `unfinished-run`:experiment id、startedAt 与目录;
- `unreadable-run`:目录、reason 与可用的 producer 身份;
- `dangling-evidence`:attempt 身份、artifactBase 与原声明的 artifacts;
- persisted diagnostic 的 Issue:observation code、phase、observed level、detail、context 与 count。

Issue 不写回 `.niceeval`,也不带呈现 message、Notice severity、action 或 command。程序消费方按
code 和结构化字段分支,不从人话里正则提取事实。Sample 的公开形状与 code 全集见
[`SampleIssue`](feature/sample/library.md#issue-code-全集)。

### Present: Notice

**解释有唯一产地:`NoticeCatalog`。** 事实单源和解释单源是同一条原则——文案散在 N 个宿主 policy
里各写一份,CLI 说的下一步和网页说的下一步迟早不一致,和「各 page 自己算数字」是同一种病。

```ts
interface NoticeDefinition<I extends Issue> {
  severity(issue: I): "info" | "warning" | "error";
  title(issue: I, locale: Locale): string;
  detail(issue: I, locale: Locale): string;
  action(issue: I): NoticeAction;
}

type NoticeCatalog = { readonly [C in KnownIssueCode]: NoticeDefinition<IssueFor<C>> };
```

Catalog 拥有语义、文案与下一步;宿主 policy 只决定**可见性、分组、去重**和**怎样把 action 投影
成自己的交互**。内建 code 必须穷尽登记——`NoticeCatalog` 的映射类型让漏一条编译不过,
不靠自觉。

**action 是结构化闭集,不是命令字符串。**

```ts
type NoticeAction =
  | { kind: "rerun"; experimentId: string; evalIds?: readonly string[] }
  | { kind: "edit"; file: string; field?: string }
  | { kind: "external"; url: string }
  | { kind: "ignorable"; when: LocalizedText };
```

CLI 把 `rerun` 投成 `niceeval exp <id>` 一行可复制命令,web 投成按钮,嵌入式产品投成自己的路由。
**宿主写的是每类 action 一个投影函数,不是每个 code 一个适配器**——N×M 因此塌成 N+M。
新增 action kind 要回这张表登记;找不到诚实投影形态的能力不该做成 action,和
[`enhance` 能力位](feature/reports/architecture.md#只有一面能做的事具名-enhance-位)同一条纪律。

**未知 code 的 fallback 也必须带下一步。** 第三方 producer 写的 code 不在 catalog 里时,
显示原始 `detail` 与 `context`,并给出一条保守的下一步:检查产生这条记录的组件版本。
只打印 code 和 detail 不算合格——「给不出下一步的报错是缺陷,与算错数字同级」对 fallback 同样成立。

## 库错误类

`catch (error) { console.error(error.message) }` 是 niceeval 作为 library 的主要用法,所以
`message` 必须自足、带下一步。它同时不能变成第二个文案产地:

```ts
class NiceEvalError extends Error {
  readonly code: KnownIssueCode;
  readonly context: IssueContext;
}
```

**`message` 由 catalog 在构造时用默认 locale 渲染,不手写。** 作者只在 catalog 写一次三段式,
`err.message` 是它的投影,CLI 与产品宿主走 `code` + `context` 本地化——两条路一个产地。
CLI 不从 `Error.message` 正则抠命令,但这不等于 `message` 可以没有下一步。

## 即时 CLI 错误

argv 解析、config 加载、记录根打开和报告装载失败时没有 `.niceeval` observation 可写。CLI 仍先构造
一个瞬时结构化 Issue,再经同一份 catalog 渲染两行反馈:

```text
error: unknown option '--agnet'
  fix: use --agent <name>; run `niceeval --help` for the flag list
```

第一行说现象与依据,第二行是 catalog 里那条 action 的 CLI 投影。瞬时 Issue 同样不带文案,
它和落盘 Issue 走同一条解释链,不另开一套。

## 新增问题的义务

1. 在事实拥有者处定义稳定 code 和最小结构化证据,并说明它是 persisted observation 还是
   read/select Issue。
2. observation 只记录 detail/context,不写操作建议;Issue 只投影事实,不写渲染文案。
3. 在 `NoticeCatalog` 登记这条 code 的严重度、文案与 action——**只登记一次**,
   宿主不重复写文案。action 用不上现有 kind 时先回闭集登记新 kind 并给出各宿主投影。
4. 测试分层证明:写入测试断言 observation 事实,读取测试断言 Issue 投影,呈现测试断言
   catalog 文案与 action 投影;并断言 `NiceEvalError.message` 与同一条 catalog 条目同源。

## 相关阅读

- [Sample · Issue code 全集](feature/sample/library.md#issue-code-全集) —— 读取与选择层的结构化问题。
- [Record · Error 与 diagnostics](feature/record/architecture.md) —— 持久化 observation 的完整形状。
- [Reports · Notice 组件](feature/reports/components/site/README.md) —— Issue 怎样变成可替换的产品解释。
