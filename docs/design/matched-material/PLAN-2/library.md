# Handle 追加评分 —— Library

候选事实、collection 完整性和三值 Match 与 PLAN-1 分别采用相同公开形状；collection 保留 items 和 coverage。



```ts
interface Collection<T> {
  readonly items: readonly T[];
  readonly coverage: { readonly state: "complete" }
    | { readonly state: "partial" | "unavailable"; readonly reason: string };
}
interface SelectionHandle<T, Kind> {
  judge(score: ScoreMatch<readonly T[]>): MeasurementAssertionHandle<Kind>;
  gate(): BooleanAssertionHandle<Kind, Collection<T>>;
}
```

应用便捷方法登记 collection 存在性，返回新增 SelectionHandle；作者 `.judge(score)` 转换为 measurement handle。


同一 candidate 上使用 and，默认至少一条。

完整空集合在转换后 measured 0，未知材料 unavailable，均不调用评分 callback。


完整非空材料按原顺序与 identity 交给受管评分，不裁剪全集后评分。


工具和事件以原 sidecar 遍历，scope cut 和三值语义不变。


```
t.said(and(npcMatch({ id }), heardByMatch({ id: player })))
  .judge(quality).gate(0.8).score(30);
```

SelectionHandle 禁止先 gate/score 再 judge；只允许一次 judge，封口或求值启动后禁止转换。


Adapter 可使用官方 check.from(read) 品牌 callable 保留 Pass/Score 和 handle 参数关联，read 必须同步。
