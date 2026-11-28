# Before cache

[Before cache](../architecture/before-cache.md) 把 before 的执行结果做成可复用的前缀，供后续 Attempt 直接从缓存开始。这里核对准备图放行、Attempt 内的前缀、普通 Docker 镜像和缓存冲突告警。每段的模型只覆盖该段写明的规模。

## 准备图

### 准备并发不超过额度 {#GateBound}

同时进行的准备不超过 `maxBeforeCacheConcurrency` 给出的额度。

### 每个配对最终放行或失败 {#DispatchTerminates}

Provider 最终结算每个节点时，准备图中每个配对最终都放行或明确失败，不会一直等待。

```statechart spec="../tla/before-cache/graph/Graph.tla" config="../tla/before-cache/graph/fixed-4-1.cfg" view="../tla/before-cache/graph/view.ts" out="../tla/before-cache/graph/out/fixed-4-1" digest="sha256:f1bfce99fb164b61033d9d813e5274777a38e73cbe606aa55eab6603f6ea3ea8"
```

四个节点、两个终端配对、一个准备额度，两条规则都成立。状态数超过图的规模上限，只显示检查报告。配对放行后的派发、Attempt 创建、取消与已发布祖先的保留不在模型内。

回放测试 `test/integration/before-cache-graph-tla-repro.test.ts` 覆盖深分支命中、跳过中间节点后冷分支仍能取得准备额度的路径。

## Attempt 内的前缀

### 已成功的 action 不重跑 {#NoReplay}

一个 Attempt 内，每个 eligible action 最多执行一次。

### 降级只回退一次 {#OneRecovery}

缓存不可用而回退时，同一 Attempt 只回退一次。

### 降级后最终结束 {#Terminates}

降级的 Attempt 最终完成或明确失败。

### 每层包含全部父层 {#CorrectPrefix}

第 k 层前缀包含第 1 到 k 层的全部结果，不缺父层。

### 上一层就绪后才执行下一层 {#ReadyForAction}

执行某个 action 时，实例里已经有它之前各层的结果。

```statechart spec="../tla/before-cache/degraded/Degraded.tla" config="../tla/before-cache/degraded/degraded-2.cfg" view="../tla/before-cache/degraded/view.ts" out="../tla/before-cache/degraded/out/degraded-2" digest="sha256:db63b694d3013cbb3d6f952a9a30f2a68bb4bc328eab2f307d30396cf65ef62c"
```

```statechart spec="../tla/before-cache/prefix/Prefix.tla" config="../tla/before-cache/prefix/prefix-new-2.cfg" view="../tla/before-cache/prefix/view.ts" out="../tla/before-cache/prefix/out/prefix-new-2" digest="sha256:bbd478ae4326676bdea02961da570909f9c7d0ee79be07eab4a6b9f6895cb14b"
```

第一块是两个 eligible action 的降级路径，第二块是一个 Attempt、两层前缀在子层未命中、父层命中时的前缀。五条规则都成立。作者 action 失败、取消、跨 Attempt 重试、并发新增或替换前缀 image 与磁盘内容不在模型内。

## 普通 Docker 镜像

### 有读者的镜像不删除 {#Protected}

仍在使用的读者租用或保护的镜像一直存在。

### 删除前没有引用 {#RegularGcSafe}

登记删除的镜像在登记时没有任何租用或保护。

### 索引只指向存在的镜像 {#ReadableIndex}

索引里的每个 key 都指向磁盘上存在的镜像。

```statechart spec="../tla/before-cache/image/Image.tla" config="../tla/before-cache/image/image-fixed-2.cfg" view="../tla/before-cache/image/view.ts" out="../tla/before-cache/image/out/image-fixed-2" digest="sha256:13db2eb8d2c86b8cfab4162ad3bdcc36bf3aaeb0c423b3cd0e119cefc1d38fbd"
```

两个进程分别生产与租用，每个 key 一代，竞争同一替换位置，三条规则都成立。状态数超过图的规模上限，只显示检查报告。生产者发布后自己的克隆失败、而读者已经租用的情形由 `test/host/before-cache-image-lease-tla-repro.mjs` 回放。

## 缓存冲突告警

### 冲突都有告警 {#Complete}

同一 Invocation、同一声明位置的两份输入，Base 或声明不同时都报告冲突。

```statechart spec="../tla/before-cache/warning/Warning.tla" config="../tla/before-cache/warning/warn-fixed-docker.cfg" view="../tla/before-cache/warning/view.ts" out="../tla/before-cache/warning/out/warn-fixed-docker" digest="sha256:d19d0e9f52ea7feb8c3b540b5ce2d4d07b2b85a7a8dc088f70427e936c6825b6"
```

```statechart spec="../tla/before-cache/warning/Warning.tla" config="../tla/before-cache/warning/warn-fixed-remote.cfg" view="../tla/before-cache/warning/view.ts" out="../tla/before-cache/warning/out/warn-fixed-remote" digest="sha256:b93557abb1f45ce7ab18eeb2e451dd5f7b965ec4ada5b62d215fdfb16f7dc280"
```

第一块是 Docker 的静态检查，实际 Base 固定；第二块是 `RunPrepared`，同一位置的实际 Base 可以变化。不同位置、运行时去重与静态阶段尚不知道的实际 Base 不在模型内。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 段 | 代码 |
| --- | --- |
| 准备图 | `runner/before-cache-preparation.ts` 的查找、需求、准备、结算与放行；`runner/run.ts` 等待派发 |
| Attempt 内的前缀 | `runner/attempt.ts` 的查找、探测、执行、捕获与回退 |
| 普通 Docker 镜像 | `sandbox/docker-cache-repository.ts` 的预约、发布、租用与回收；`sandbox/docker-before-cache.ts` 的制作、保护与删除 |
| 缓存冲突告警 | `runner/before-cache-collisions.ts`；`runner/run.ts`；`runner/before-cache-preparation.ts` 报告实际 key |

## 模型没有覆盖的部分

配对放行后的并发额度与 Attempt 创建、取消时保留已发布祖先、远端 snapshot 的租约与延迟删除、Incus，以及上面各段列出的省略。
