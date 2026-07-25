# `Conversation`

分轮事件流：一轮一张卡片，卡内是 user / assistant / thinking / tool / Skill / HITL / error 条目。
[`SourceView`](source-view.md) 的行内展开区与兜底区复用这一套渲染，不写第二份实现。

```tsx
<Conversation source={attemptConversation} />
```

## 形状

```ts
interface ConversationEntry {
  /** 条目类别；决定图标与色。词表由数据源给，原语不建注册表、不拒绝未知成员。 */
  kind: string;
  /** 单行预览。自由文本在字符串化之前已收口，渲染面只做宽度截断。 */
  preview: LocalizedText;
  /** 展开后的完整内容；空即该条不可展开。 */
  detail?: ReportNode;
  failed?: boolean;
}

interface ConversationTurn {
  key: string;
  /** 轮标签，如 turn3。 */
  label: LocalizedText;
  verdict?: "passed" | "failed" | "errored" | "skipped";
  entries: readonly ConversationEntry[];
}
```

## 渲染

- web 面：一轮一张卡片，带 verdict 色左缘与轮标签头行；条目逐条一行，
  可展开的用原生 `<details>`，静态文档零 JS 成立。
- text 面：轮次摘要加下钻命令，不倾倒逐条明细——完整事件流有稳定的 CLI 选择器。
- 条目的单行预览在字符串化**之前**收口自由文本：剥控制字节、折空白。结构化值先逐字段收口
  再序列化——事后处理收不到已经变成字面转义文本的换行与控制字节。
- 样式按容器限定，新容器不会自动继承。把这套渲染放进新容器时一并补齐样式覆盖。

## 相关阅读

- [组件树](../README.md) —— 三层模型与双面投影边界。
- [`SourceView`](source-view.md) —— 复用本原语的两个位置。
- [数据源目录](../sources/README.md) —— 事件流数据源与失败命令卡。
