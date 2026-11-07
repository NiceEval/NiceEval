# 两个配对共享 before 缓存后并行

我让两个 Eval×Experiment 配对分别需要准备序列 `Base → 1 → 2 → 3` 与 `Base → 1 → 2 → 4`。我不希望相同的 runtime 和 fixture 被准备两遍，也不希望较慢的另一个末段阻塞独立后缀的并行准备。

当 Provider 声明 `RunPrepared` 能力时，Run 在派发任何 Attempt 前构建按完整 `BeforeCacheKey` 去重的[准备图](../../../concepts.md#before-cache-preparation-graph)：`1` 与 `2` 各只准备一次；`2` 发布后，`3` 与 `4` 可以并行。总准备成本因此是：

```text
cost(1) + cost(2) + max(cost(3), cost(4))
```

并行数同时受 `maxBeforeCacheConcurrency` / `--max-before-cache-concurrency` 与 Provider `scheduling.lane.limit` 限制。准备图的所有节点都结算后，Run 才派发 Attempt；某节点失败只阻断它的 descendants，另一分支仍可结算和派发。普通 Docker、Docker Profile、Vercel 与 custom provider 不声明 `RunPrepared`，不参与准备图；E2B、OpenSandbox 与 Instabox 参与，见[云 Sandbox 的一批 Attempt 只准备一次](sandbox-cloud-before-cache.md)。

需要核对宿主上由 NiceEval 拥有的 before 缓存时，我运行 `niceeval docker cache inventory`。同一 Docker images Domain 把该 artifact 作为 `sandbox-before-cache` entry 展示，并给出 identity、state、lease/hold 数与时间字段；这项只读归属不会让 `docker cache gc` 回收 before 缓存。
