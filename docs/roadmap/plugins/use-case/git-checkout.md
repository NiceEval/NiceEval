# Git checkout Plugin

## 产品调用

同一 repository 的 Eval 共享 factory，每题只声明自己的完整 base commit：

```ts
const downshift = gitRepository({
  repo: "https://github.com/downshift-js/downshift.git",
  into: ".",
  instanceKey: "downshift",
});

export default defineEval({
  plugins: [downshift.checkout({ commit: BASE_COMMIT })],
  async test(t) {
    await t.agent("修复当前问题");
  },
});
```

复用组只声明成员与实例不可用策略：

```ts
export default defineSandboxGroup({
  evals: [pr101, pr205, pr309],
  onUnavailable: "replace-sandbox",
});
```

没有 `repositories` 字段。Runner 从所选成员的 Plugin resource demands 自动形成 cohort；core 不认识 repo、commit、`.git` 或 fetch。

## 聚合与实例生命周期

冻结选择命中的全部 pair demands 进入 cohort。未选组员不进入；同 commit 的多个 Attempt 不复制 demand。全 carry 时不创建 Sandbox；只要有一条真实派发，就 materialize 全部 selected union，包括后来 carry 重判命中的成员。

Git receiver 按 canonical repo 与 auth revision 合并 seed key，验证全部完整 commit OID，并在每台 physical Sandbox 首题前取得一次只读 seed。每条 Attempt 在 reset 后删除上一题工作树和可写 Git metadata，从 seed 创建新的 metadata 与 detached checkout；后续 prepare 再继续。

同 repo 不同 `into` 共享 seed；不同 repo 抢同一 `into` 在创建资源前失败。previous Attempt 写入 hooks、config、refs 或 remote 不会进入下一题。

## Fingerprint 与可见性

aggregate projection 进入 cohort 每个 selected pair fingerprint 和同源 manifest。单跑 A 与同跑 A+B 是不同 Sandbox 条件，因为 A 在后者能看见 B 的 Git objects；B 的 commit、`into` 或 receiver revision 变化会让 A 失去携带资格。

这项模式隔离写污染，不隐藏同组其它 commits。未来 commit 属于隐藏答案的 Eval 必须保持 fresh，不加入 reuse group。

## 失败与替换

- demand-invalid：坏 OID、目标冲突等零资源配置错误，不重试。
- demand-unsatisfied：materialize 后仍缺少需求，停止当前 cohort，不用 replacement 重试同一静态错误。
- instance-unavailable：seed 损坏、权限漂移或实例消失，按 `stop-group` / `replace-sandbox`。
- attempt-consume-failed：当前 Attempt errored、实例退休，尚未派发项再按组策略处理。

`replace-sandbox` 在新实例重新 materialize 全部 aggregate；不重跑已经产生模型成本的 Attempt。`stop-group` 不创建替代实例。中断收尾不触发 replacement。

## 通用能力边界

Git checkout 完全由 official Plugin receiver 实现。NiceEval core 只提供 opaque demand、cohort 聚合、把 aggregate projection 写入每个 pair、physical-instance lifecycle、failure union 与 provenance。

其它需要“多 pair 先聚合、每台 Sandbox 初始化一次、每 Attempt 消费”的产品可以复用同一协议。
