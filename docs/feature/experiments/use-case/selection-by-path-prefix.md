---
format: concord.document/v1
id: selection-by-path-prefix
title: 按路径前缀选择 Eval
createdAt: 2026-07-27T18:06:13+08:00
kind: use-case
feature: docs/feature/experiments/README.md
---

# 按路径前缀选择 Eval

Experiment 长期负责某个目录下的一族 Eval 时，在 `evals` 中声明路径前缀：

```ts
export default defineExperiment({
  evals: ["memory/"],
  // ...
});
```

路径表达稳定身份和选择范围，不携带业务配置。
一次运行只想临时缩小到某道题时，不改 Experiment，使用[CLI 选择器](selection-dry-preview.md)。
