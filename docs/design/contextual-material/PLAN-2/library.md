# 材料 reader 绑定 —— Library

```ts
interface MaterialSource<T> {
  readonly name: string;
  (match: BooleanMatch<T, T>): MaterialSelector<T>;
}
defineMaterialSource<T>({ name: string }): MaterialSource<T>;
bindMaterialSource<T>(source: MaterialSource<T>, read: () => MaterialCollection<T>): void;
check<T>(selector: MaterialSelector<T>): BooleanAssertionHandle<Kind, void>;
closeQA<T>(selector: MaterialSelector<T>, question: string,
  options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
```

`MaterialCollection` 包含 complete 有序项、partial 有序项及 reason、unavailable reason。
每项含稳定 id 与 value。材料工厂只接受 BooleanMatch；不接收 ScoreMatch。

```ts
const speech = defineMaterialSource<GameEvent>({ name: "speech" });
assertions({ app, check, bindMaterialSource }) {
  bindMaterialSource(speech, () => app.speech);
  return { said(match: BooleanMatch<GameEvent, GameEvent>) { return check(speech(match)); } };
}
t.closeQA(speech(npcMatch({ id: "a" })), "每句是否自然完整？").gate(.8);
```

用量入口为 `usageSnapshot()`，elapsedMs 为方法。Snapshot 提供每个物理 call 的账本与 NumericMaterial token 统计。
Agent 保留原有 Usage，Adapter 返回独立 usage snapshot 类型，因此两种作者入口不统一。
