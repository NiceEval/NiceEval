# `--force`:指纹未变但外部世界变了,全量重验

## 解决什么问题

缓存指纹算的是 `(eval 代码 + 相关配置)`:两者都没变时,上一轮判定为终态(`passed` / `failed`)的结果默认携带合入本次快照,不重花 agent / sandbox 成本。但指纹之外的世界会变——agent CLI 发了新版、被测的外部服务改了行为、沙箱镜像里的依赖被重建。这时携带的旧「绿」掩盖的可能是真实回归:你以为在验证现状,其实在复读历史。`--force` 忽略全部可复用结果,把选中的矩阵完整重跑一遍。

## 全流程

1. 先看默认行为里缓存吃掉了多少:`PLAN` 面板的复用行只给数量(见 [CLI · 运行中的 live 面板](../cli.md#运行中的-live-面板)):

   ```text
   │ 6 of 45 carried in from cache · 39 to run                                     │
   ```

2. 升级 agent CLI 后重验,先收窄选择再 `--force`——全量重跑是把矩阵的钱重新花一遍,范围越小越好:

   ```sh
   niceeval exp compare/bub-e2b memory/commit0-cachetool --force
   ```

3. `--force` 关闭携带:计划内每个 attempt 全新派发,没有 `reused`;本次的 tok 与 $ 是完整矩阵的真实开销,没有缓存摊薄(计数与成本口径见 [CLI · 运行中的 live 面板](../cli.md#运行中的-live-面板))。
4. 新结果落成新快照并成为下一轮携带的来源;历史快照保留,`niceeval view` 仍可对照升级前后的两轮。
5. 确认无回归后回到默认模式:后续 run 按指纹采信这轮 `--force` 产出的终态,「改一个 case 重跑」继续只花那一个 case 的时间(见 [Runner · 缓存](../../../runner.md#缓存指纹去重))。

## 边界

- `--force` 是一次性全量重验,不是长期开关:它不改指纹定义,下次不带它的 run 照常携带——外部依赖如果频繁变化,把它显式纳入配置让指纹自然失效,比每次手动 `--force` 更可靠。
- 改了 eval 代码或配置本身就会重跑,不需要 `--force`;`errored` / `skipped` 从不缓存、总会重试,也不需要它;`--reuse-sandbox` 运行本就不消费携带,`--force` 在那里没有作用对象。
- 默认模式不藏旧失败:全部命中缓存的零派发运行,携入的 `failed` 照常进 `FAILURES` 并给下钻命令(见 [CLI · 全部命中缓存](../cli.md#全部命中缓存))——`--force` 解决的是「携入的绿过期」,不是「失败被吞掉」。
- coding agent 的自动修复循环正常依赖指纹缓存省钱,只在怀疑缓存口径时才加 `--force`(见 [CLI · AI 常见循环](../cli.md#ai-常见循环))。

## 相关阅读

- [Runner · 缓存:指纹去重](../../../runner.md#缓存指纹去重) —— 指纹构成、携带粒度、终态定义的单源。
- [Results · 两类条目](../../results/architecture.md#resultjson) —— 携带条目怎样落盘与回指原 artifact。
