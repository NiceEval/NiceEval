---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 读懂同类错误摘要

一次批量运行可能让多个评估对象命中同一个已知配置错误。
用户需要在首次失败时立即看到修复动作，也需要在终局确认波及范围，但不需要连续阅读相同的长指南。

## 先读首次提示

每个已知组的第一条 occurrence 立即显示原因、owner、source location 和下一步。
迁移错误还会显示完整的随包英文指南。后续相同组只增加计数和有界样本，不重复长正文。

```text
error: Judge credentials are unavailable.
Code: judge-key-unresolved
Source: evals/quality-a.eval.ts:8:10
Set TYPESAFE_API_KEY before running this evaluation.
```

## 再读终局摘要

命令收尾时，摘要按组显示 count、affected objects 和 source locations。
一组最多展示 32 个对象和 32 个位置，其余用 omitted 数量表示；整个投影最多保留 32 组。

```text
Summary: judge-key-unresolved (judge-runtime) × 12
Affected: quality-a, quality-b, quality-c, +9 more
Sources: evals/quality-a.eval.ts:8:10, evals/quality-b.eval.ts:9:10, +10 more
```

只有 code、owner、repair target 和 guide ID 全部相同才是同一组。
四元组任一值不同就分开展示。未知错误没有 owner 交付的稳定分组身份，因此不会仅凭 message 相似就合并。

摘要是人读投影，不会替换领域 owner 保留的每条失败事实。
精确键、容量与退化规则见 [Architecture](../architecture.md#人读分组投影)；输出次序见
[CLI](../cli.md#同类错误的首次提示与终局摘要)。
