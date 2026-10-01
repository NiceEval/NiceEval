# Limits

当前证据绑定于 HEAD 05dec8c7。`assertions({ app, check })` 提供守卫后的应用对象和两参数 registrar。
普通断言方法的泛型和 overload 在绑定后不可调用，见 `packages/niceeval/src/adapter.ts`。

`and` 已对同一 candidate 求值。工具和事件 collection 的三值求值带 scope sidecar，普通数组没有这套身份。
`defineValueMatch` 的自定义 callback 只接受 Boolean；`ScoreMatch` 的高级 callback 使用受管 LLM context。

受管评分在登记时捕获材料并约束材料与审计容量。设计不能另建模型 runtime、绕过取消或复制核心 evaluator。

不修改消费者、不调用付费模型、不 push、不发布。独立方案 Review 使用用户指定的 Herdr GPT-6 Astra/max。
