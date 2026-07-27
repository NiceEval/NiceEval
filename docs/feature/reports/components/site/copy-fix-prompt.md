# `fixPrompt`

`fixPrompt` 把当前 Sample 的全部失败（verdict 为 `failed` / `errored` 的 attempt）整理成
[`CopyBlock`](../primitives/copy-block.md) 可消费的修复 prompt。prompt 在 resolve 阶段算好；
「复制到剪贴板」只是一项渐进增强。

```ts
interface CopyFixPromptContent {
  /** 修复 prompt 全文；失败逐条含 eval id、主失败摘要与 attempt 下钻命令。 */
  prompt: string;
  /** 参与 prompt 的失败 attempt 数。 */
  failures: number;
}

declare const fixPrompt: DataSource<CopyBlockContent, Sample>;
```

`failures` 为 0 时两面零输出。text 面零输出——终端里的等价能力是 `show` 的 attempt 下钻命令本身，不打印整段 prompt。

```tsx
<CopyBlock source={fixPrompt} />
```

## 相关阅读

- [`CopyBlock`](../primitives/copy-block.md) —— 通用可复制文本原语。
