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

Notice policy 消费 Issue 与已经投影好的其它事实,产生读者可见的:

- 本地化 title 与 detail;
- `info | warning | error` 严重度;
- 分组、去重与可见性;
- 适用于当前宿主的 action,包括可复制 command、定位动作或忽略条件。

用户可见的 Notice 必须说清现象、依据与下一步。这是 Notice policy 的责任,不是 writer 或
Issue 数据形状的责任。同一个 Issue 在 CLI 可以给出一条命令,在嵌入式产品中可以映射为
链接或按钮;两者不改变底层 Issue。

## 即时 CLI 错误

argv 解析、config 加载、记录根打开和报告装载失败时没有 `.niceeval` observation 可写。CLI 仍先构造
一个瞬时结构化 Issue,再由 CLI policy 渲染两行反馈:

```text
error: unknown option '--agnet'
  fix: use --agent <name>; run `niceeval --help` for the flag list
```

第一行说现象与依据,第二行给当前 CLI 可执行的下一步。瞬时 Issue 同样不带文案或 action;
两行文本都由 CLI policy 产生。库错误类保留稳定 code 与结构化 context,CLI 不从 `Error.message`
解析修复命令。

## 新增问题的义务

1. 在事实拥有者处定义稳定 code 和最小结构化证据,并说明它是 persisted observation 还是
   read/select Issue。
2. observation 只记录 detail/context,不写操作建议;Issue 只投影事实,不写渲染文案。
3. 在需要呈现它的每个 Notice policy 中登记本地化文案、严重度和下一步;未知 code 必须有保守 fallback。
4. 测试分层证明:写入测试断言 observation 事实,读取测试断言 Issue 投影,呈现测试断言
   Notice 文案与动作。

## 相关阅读

- [Sample · Issue code 全集](feature/sample/library.md#issue-code-全集) —— 读取与选择层的结构化问题。
- [Record · Error 与 diagnostics](feature/record/architecture.md) —— 持久化 observation 的完整形状。
- [Reports · Notice 组件](feature/reports/components/site/README.md) —— Issue 怎样变成可替换的产品解释。
