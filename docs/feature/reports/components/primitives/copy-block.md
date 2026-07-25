# `CopyBlock`

一整块可复制的文本：修复 prompt、补跑脚本、可直接粘给 agent 的指令。文本在 resolve 阶段
算好、烘进静态 HTML；「复制到剪贴板」是增强层行为，无 JS 时文本在折叠块里完整可读——
增强只加浏览行为，不改内容。

```tsx
<CopyBlock source={fixPrompt} />
```

## 形状

```ts
interface CopyBlockData {
  /** 整块文本全文。 */
  text: string;
  /** 折叠块的标题，含条数这类规模信息。 */
  title: LocalizedText;
}

interface CopyBlockProps {
  source?: DataSource<CopyBlockData | null>;
  input?: ReportInput | AttemptEvidence;
  data?: CopyBlockData | null;
  locale?: ReportLocale;
  className?: string;
}
```

## 渲染

- web 面：原生 `<details>` 折叠块，标题行右侧是复制按钮，展开即全文。
- text 面零输出。终端里的等价能力是下钻命令本身，把整段 prompt 打进终端只会淹没
  用户正在读的结果。
- 数据源返回 `null` 时两面零输出，不渲染空容器。

## 相关阅读

- [组件树](../README.md) —— 三层模型与双面投影边界。
- [数据源目录](../sources/README.md) —— 修复 prompt 的组装口径。
