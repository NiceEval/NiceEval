# `AttemptDetails`

`AttemptDetails` 显示宿主已经装配的一份 AttemptEvidence：

```tsx
<AttemptDetails attempt={attempt} />
```

它不读取 Record，不接受惰性数据源，也不另建 modal 或旁路内容槽。
组件内部只调用公开的同步投影与显示原语。

## 输入

```ts
interface AttemptDetailsProps {
  attempt: AttemptEvidence;
  locale?: ReportLocale;
  className?: string;
}
```

AttemptEvidence 在每个 Attempt 只装配一次。
它包含身份、verdict、断言、诊断与可用 artifact 的惰性读取句柄； page render 在构造自定义详情时显式 `await` 所需转换。

## 默认内容

默认详情按稳定顺序呈现：

1. locator、Experiment、Eval、Attempt 与 verdict。
2. 开始时间、耗时、成本、得分与 usage。
3. 基础设施问题和持久化 diagnostics。
4. 标注 Eval 源码；没有源码时显示断言表。
5. 可行动失败的修复 prompt。
6. 执行时间树、按生命周期定位的非零命令证据、未映射的对话证据、trace 与 [文件差异](attempt-diff.md)。

某类证据缺失时对应区块零输出或显示明确缺失，不伪造空值。
全部数值由同一 AttemptEvidence 投影，`show` 切片与详情页不各算一份。

执行对话的 `events` artifact 是可选证据。
`AttemptDetails` 始终调用 `toConversationTurns(evidence)`。

源码与事件同时存在时，可按源码位置对应的每一轮 `Conversation` 进入相应 `send` 行的展开区。
这些轮不在源码后重复渲染；没有源码位置的轮仍留在页面级 `Conversation`。
源码不可用时，全部对话按原顺序显示在页面级 `Conversation`。

非零 Sandbox 命令不归入任何 `Conversation`。Attempt 详情将其投影为独立的 lifecycle 命令区块，并按 timing 顺序放在对应阶段：setup 命令先于 Turn，teardown 命令后于 Turn。unchecked 命令使用中性 `observed` 样式；只有 checked 方法因非零抛出的命令使用失败样式。

结果为 `null` 时在 Web 与 Text 两面渲染 warning `Callouts`。
标题为 `Execution evidence unavailable`，内容为 `The events artifact is missing or was not published.`

源码行只显示状态与耗时，不显示内部轮坐标。事件 artifact 读取损坏时沿现有转换器抛错，不把损坏吞成缺失提示。

## 自定义详情

Attempt 详情是一张按 locator 参数化的 page，自定义时只换 `render`，`params` 与 `load` 沿用 [`standardAttemptPage`](../../library.md#参数化页attempt-与-experiment-详情)：

```tsx
{
  ...standardAttemptPage,
  render: async (attempt) => {
    const [turns, files] = await Promise.all([
      toConversationTurns(attempt),
      toDiffFiles(attempt),
    ]);

    return (
      <Col>
        <Conversation turns={turns} />
        <DiffView files={files} />
      </Col>
    );
  },
}
```

要改顺序或删区块，直接写 page render。
显式 `--report` 装载的报告没有 attempt page 时，报告 text 面的 locator 是普通文本，不生成一条会改变报告语义的报告内命令；不带 `--report` 的 `show @<locator>` 仍由官方 `AttemptDetails` 提供稳定诊断。`view` 使用官方 `AttemptDetails` 作为隐式详情页，让 web locator 保持可下钻。

## Usage 单源

轮数与工具调用数从标准事件流派生； token 和请求计数来自落盘 Usage；成本来自相同 Attempt 事实。
缺失字段整段省略，不用零或请求数 `1` 填充。

缓存拆分存在时，输入 token 明确区分 uncached input 与 cache read；协议没有拆分事实时只显示 input tokens，不贴猜测标签。

## 两面

text 面按终端任务顺序输出精确区块； web 面使用同一份值树输出语义 DOM，并可把 locator 链接渐进增强为 dialog。
dialog 只换摆放位置，不建立第二份内容实现。

## 相关阅读

- [Attempt diff](attempt-diff.md) —— 文件差异的来源、可用性与 `DiffResult` 形状。
- [Library · Attempt 详情](../../library.md#attempt-详情)
- [Architecture · Attempt 详情](../../architecture.md#attempt-详情)
- [show attempt](../../show/attempt.md)
