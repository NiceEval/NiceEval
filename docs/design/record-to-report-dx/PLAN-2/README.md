# PLAN-2：Scoped loader + ordinary TypeScript

每份 Report 只有一个 scoped `load()`。Host 先按调用者给出的 selection 建立 Analysis；作者在 callback
中直接 `await` Attachment 读取和普通函数计算，再返回一个普通数据模型。Pages 与 Downloads 只消费这个模型。

```ts
export default defineReport({
  id: "quality-report",

  async load(analysis) {
    const attempts = await analysis.attemptSlots({
      selectedRun: { evaluation: evaluations },
      attempt: { assertions, verdict, score: allowUnavailable(score) },
      originRun: { evaluation: evaluations },
    });

    return {
      quality: passRate(attempts),
      attempts: attemptDetails(attempts),
    };
  },

  pages: {
    overview: page({
      route: "/",
      render: ({ model }) => overviewDocument(model.quality),
    }),
  },

  families: {
    attempts: pageFamily({
      instances: ({ model }) => model.attempts,
      key: ({ slot }) => logicalSlotKey(slot),
      route: ({ slot }) => attemptRoute(slot),
      render: ({ instance }) => attemptDocument(instance),
    }),
  },
});
```

## 核心心智

这套 API 类似 web framework loader。Host 先从 frozen Record 建立 `AnalysisSession`，`load()` 是唯一
能读取它的地方；它结束后 reader 关闭，剩下的 model、Page 与 Download 都是纯值。

作者不学习 query graph、Projection 或 Calculation，也不区分 declaration 与 execution。依赖顺序、
条件读取、并行与复用都使用普通 TypeScript。

代价是 loader 是粗粒度失败边界。任何一项取数或公式 throw，整份 model 都无法形成；host 不能自动
判断 callback 中哪段表达式只影响哪一页。

## 范围

包含 scoped `RecordSession`、host-owned selection、typed aligned reads、单一 loader、普通 model、Pages、
PageFamilies 与 Downloads。不包含静态 query DAG、跨 Report loader cache 或任意组件 I/O。

## Cases

本候选的可核查状态见 [Evaluation](../EVALUATION.md)。C4a 可以由 loader 显式共享 model value；C4b
不满足，因为一个公式失败会阻止整份 Report。C10 复用 `withRecord()`、Analysis reads 与同一批普通
函数，不需要 Report 类型；C11 仍受当前完整 blob snapshot 限制。其它 Cases 尚未逐一展开。

## 入口

- [Library](library.md)：Record session、loader 与 model。
- [Architecture](architecture.md)：Scope、缓存、失败边界与交付。
- [Attempt detail](use-case/attempt-details.md)：多 Attachment 对齐。
