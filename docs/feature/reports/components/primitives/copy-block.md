# `CopyBlock`

一整块可复制的文本：修复 prompt、补跑脚本、可直接粘给 agent 的指令。
文本在 page render 中算好、烘进静态 HTML；「复制到剪贴板」是增强层行为，无 JS 时文本在折叠块里完整可读——增强只加浏览行为，不改内容。

```tsx
<CopyBlock content={fixPrompt} />
```

或分开传标题与正文：

```tsx
<CopyBlock title="Fix prompt" text={prompt} />
```

## 形状

```ts
interface CopyBlockContent {
  /** 整块文本全文。 */
  text: string;
  /** 折叠块的标题，含条数这类规模信息。 */
  title: LocalizedText;
}

type CopyBlockProps = {
  title: LocalizedText;
  text: string;
  locale?: ReportLocale;
  className?: string;
} | {
  content: CopyBlockContent | null;
  title?: never;
  text?: never;
  locale?: ReportLocale;
  className?: string;
};
```

`CopyBlockContent` 与 `CopyBlockProps` 的唯一 owner 是本页；`LocalizedText` 与 `ReportLocale` 由 [Reports Library](../../library.md#通用值文本与参数) owner。

## 渲染

- web 面：原生 `<details>` 折叠块，标题行右侧是复制按钮，展开即全文。
- text 面零输出。
  终端里的等价能力是下钻命令本身，把整段 prompt 打进终端只会淹没用户正在读的结果。
- `content` 为 `null` 时两面零输出，不渲染空容器。

## 相关阅读

- [组件树](../README.md) —— 报告组件与双面投影边界。
- [`toSampleFixPrompt`](../../library.md) —— 修复 prompt 的组装口径。
