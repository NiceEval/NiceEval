# `CopyFixPrompt`

把当前范围的全部失败（verdict 为 `failed` / `errored` 的 attempt）整理成一段可交给 coding agent 的修复 prompt。prompt 文本在 resolve 阶段算好，烘进静态 HTML；「复制到剪贴板」是增强层行为，无 JS 时 prompt 文本在折叠块里完整可读——增强只加浏览行为，不改内容。

```ts
interface CopyFixPromptData {
  /** 修复 prompt 全文；失败逐条含 eval id、主失败摘要与 attempt 下钻命令。 */
  prompt: string;
  /** 参与 prompt 的失败 attempt 数。 */
  failures: number;
}

function copyFixPromptData(input: ReportInput): Promise<CopyFixPromptData>;

type CopyFixPromptProps = ComponentProps<CopyFixPromptData, {
  locale?: ReportLocale;
  className?: string;
}>;
```

`failures` 为 0 时两面零输出。text 面零输出——终端里的等价能力是 `show` 的 attempt 下钻命令本身，不打印整段 prompt。

```tsx
<CopyFixPrompt />
```

## 相关阅读

- [站点组件](README.md) —— 这一族为什么不收结构子节点。
