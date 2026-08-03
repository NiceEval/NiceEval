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
6. 执行时间树、对话、trace 与 [文件差异](attempt-diff.md)。

某类证据缺失时对应区块零输出或显示明确缺失，不伪造空值。
全部数值由同一 AttemptEvidence 投影，`show` 切片与详情页不各算一份。

执行对话的 `events` artifact 是可选证据。
`AttemptDetails` 始终调用 `toConversationTurns(evidence)`。
有对话内容时渲染 `Conversation`。
结果为 `null` 时在 Web 与 Text 两面渲染 warning `Callouts`。
标题为 `Execution evidence unavailable`，内容为 `The events artifact is missing or was not published.`
源码与事件同时存在时仍显示 `Conversation`，不因源码区块已存在而隐藏对话。事件 artifact 读取损坏时沿现有转换器抛错，不把损坏吞成缺失提示。

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
