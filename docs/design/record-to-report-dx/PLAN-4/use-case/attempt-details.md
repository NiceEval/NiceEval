# Attempt detail：三层与四层

## 三层

```ts
const report = defineReport({
  load: Effect.fn(function* (analysis) {
    const rows = yield* analysis.attemptSlots({
      selectedRun: { evaluation: evaluations },
      attempt: { assertions, verdict, score: allowUnavailable(score) },
      originRun: { evaluation: evaluations },
    });

    return { attempts: attemptDetails(rows) };
  }),
  families: { attempts: attemptPages },
});
```

`attemptDetails()` 是普通函数。它失败时整个 `load()` 失败；host 不知道 Assertions 与 Score 分别被
哪些页面使用。

## 四层

```ts
const attemptRows = attemptFacts({
  selectedRun: { evaluation: evaluations },
  attempt: { assertions, verdict, score: allowUnavailable(score) },
  originRun: { evaluation: evaluations },
});

const details = derive({
  from: { rows: attemptRows },
  compute: ({ rows }) => attemptDetails(rows),
});

const report = defineReport({
  families: {
    attempts: pageFamily({ data: details, ...attemptPages }),
  },
});
```

Host 能把 `details` 的 failure 限制到 Attempt family，也能与 Download 共享同一次结果。最小成本是
作者必须声明 typed inputs，并接受普通动态控制流不能直接进入 dependency graph。只有请求跨 execution
cache、持久 provenance 或独立序列化时才补 stable id 与 output Schema。

两种形态返回同样的穷尽 Attachment states、selected/origin lineage 与 logical slot identity；层数不能
成为丢失数据语义的理由。
