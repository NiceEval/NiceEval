# 按 ID 前缀选择 Eval

Experiment 长期负责同一 ID 前缀下的一族 Eval 时，在 `evals` 中声明前缀：

```ts
export default defineExperiment({
  evals: ["memory/"],
  // ...
});
```

声明了稳定 ID 的 Eval 移动后，只要 ID 仍以 `memory/` 开头，就仍在选择范围内。
一次运行只想临时缩小到某道题时，不改 Experiment，使用[CLI 选择器](selection-dry-preview.md)。
