# 复用池

一次 Invocation 里，同一 Experiment、同一物理身份与 Eval Group 的 Attempt 共用一个 Sandbox [复用池](../library/reuse.md)：借出、执行、清理、重置后交给下一条 Attempt；寿命不足或重置失败的实例退休并重建；中断随时可能到来。这一页用模型检查器穷举这些交错。

## 规则

### 同一 Sandbox 只交给一条 Attempt {#ExclusiveLease}

执行、清理、归还都算租用期；租用期内同一个 Sandbox 不交给第二条 Attempt。

### 不超过容量 {#WithinCapacity}

已登记与正在创建的 Sandbox 共用池的容量上限；退休的实例释放名额。

### 取消先到则不通过 {#NoPassAfterCancel}

取消先赢得一条 Attempt 的封口时，它没有通过结果；封口先完成时保留结果。

### 关池时没有遗留 {#CompleteSweep}

池关闭完成时，没有登记或正在创建的 Sandbox，也没有执行、清理或归还中的租借。

### 有限批次最终关池 {#Progress}

Provider 的操作最终完成或报错时，每条请求取得 Sandbox 或在失败、取消后结束，池最终关闭。

## 模型

```statechart spec="../tla/reuse-pool/Pool.tla" config="../tla/reuse-pool/pool-2.cfg" view="../tla/reuse-pool/view.ts" out="../tla/reuse-pool/out/pool-2" digest="sha256:97fbe01ca681785d7fe33115ef8d2f6d4be916da428b5eb8f07ec3cfc34a7a3b"
```

两条 Attempt、容量一，覆盖先归还再借给另一条、寿命不足退休后重建、创建与中断交错。五条规则都成立。曾经的缺陷是退休实例仍占着容量，等待者既借不到也建不了替代（见 `memory/reuse-pool-retired-entries-deadlock.md`）；模型使用退休后释放名额的现行路径。

新实例的多次寿命检查、准备与创建收尾合并为一步；正常封口与取消后的清理合为一条箭头；所有 Attempt 结束后才到达的中断不画。两名等待者同时探查同一空闲实例需要更大的配置，不在这一块内。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 动作 | 代码 |
| --- | --- |
| 占名额创建、创建失败、借出 | `runner/sandbox-pool.ts` |
| 寿命确认、退休与重建 | `runner/sandbox-pool.ts` |
| 中断、取消等待、封口 | `runner/run.ts` 的派发中断；`runner/attempt.ts` 的封口与 deadline |
| 关闭接口、重置或退休 | `runner/run.ts`；`runner/attempt.ts`；`sandbox/request-executor.ts` |
| 关池 | `runner/run.ts` 冻结池；`runner/sandbox-pool.ts` 等待并清理 |

## 模型没有覆盖的部分

Provider 永不回应或响应丢失、远端的物理销毁、cleanup 一直挂起、工作区重置的具体内容，以及其它池与外部调度。
