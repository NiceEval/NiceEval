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

## 自定义详情

Attempt 详情是一张 `input: "attempt"` 的参数化 page：

```tsx
{
  id: "attempt",
  title: "Attempt",
  input: "attempt",
  navigation: false,
  render: async (attempt) => {
    const [turns, files] = await Promise.all([
      toConversationTurns(attempt),
      toDiffFiles(attempt),
    ]);

    return (
      <Page title={attempt.locator}>
        <Conversation turns={turns} />
        <DiffView files={files} />
      </Page>
    );
  },
}
```

要改顺序或删区块，直接写 page render。
报告没有 attempt page 时，`show` 的 locator 仍是普通文本，不生成一条会改变报告语义的命令； `view` 则使用官方 `AttemptDetails` 作为隐式详情页，让 web locator 保持可下钻。

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
