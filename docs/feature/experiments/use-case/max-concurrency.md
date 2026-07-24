# `--max-concurrency`:本地资源耗尽或 provider 限流,收并发

## 解决什么问题

一批 attempt 并发起沙箱,瓶颈常常不在 agent:本地 Docker daemon 同时建几十个容器把 CPU / IO 打满,attempt 互相拖慢、原本能过的题超时判 `errored`;云 provider 侧则是配额——沙箱分配 429、agent API 限流。这些都不是题目的问题,是并发开太大。`--max-concurrency` 把全局并发压到环境撑得住的水位,一次运行内生效,不改任何签入配置。

## 全流程

1. 带上并发上限跑:

   ```sh
   niceeval exp compare --max-concurrency 19
   ```

2. 全局并发上限的解析链是 `--max-concurrency` → `NICEEVAL_MAX_CONCURRENCY` → 配置 `maxConcurrency` → 该沙箱 provider 的推荐默认值(`docker` 10 / `e2b` 20 / `vercel` 1 / `local` 1)。推荐值反映 provider 侧约束;你的 agent API 限速自己用 `--max-concurrency` 压(见 [Runner · 调度](../../../runner.md#调度有界并发))。
3. 实验级 `maxConcurrency` 是另一道闸:只让该实验自己的 attempt 排队,不参与全局解析——两道都过才真正开跑。收全局不解除实验闸,反之亦然;串行化有共享状态的实验(如跨 eval 累积记忆)靠实验文件里的 `maxConcurrency: 1`,不靠这个 flag。
4. 在 live 面板观察并发是否落到位:`PLAN` 面板给出本次并发(`concurrency 19`),live 面板首行的互斥计数任何一帧都满足 `total = reused + running + queued + completed`:

   ```text
   │ 45 total · 6 reused · 19 running · 12 queued · 8 completed                     │
   ```

   `running` 稳定顶在上限、`queued` 逐步消化,说明并发位是瓶颈;`running` 长期不满则瓶颈在别处(实验级闸、provider 独占串行或等待实验级 setup)。

   `running` 计的是进行中的 attempt,不是持位数。turn 退避睡眠中的 attempt(ACTIVE 行形如 `turn retry 2/4 (rate_limit) — waiting 3s`)让出了并发位但仍计 `running`,让出的位派给新 attempt——所以撞限流时 `running` 会**超过**上限,超出的行数恰等于正在退避的行数,任一瞬间真正持位执行的仍 ≤ 上限。这不是并发上限失效,是[退避让位](../../error-classification/architecture.md#退避与槽位)的正常样子。
5. 还在撞限流时(active 行反复出现 provisioning retry、最终 `errored · sandbox.create`),降一档重跑同一条命令:已完成的终态 attempt 按指纹携带,只重试挂掉的(见 [Runner · 缓存](../../../runner.md#缓存指纹去重))。

## 边界

- `vercel` 推荐值 1 是 provider 的 session 并发限制,强行开大就 429;`local` 这类声明独占串行(`exclusive`)的 provider 有一道 provider 级串行闸,`--max-concurrency` 不解除——那是正确性约束,不是调度参数。
- agent 服务端按用户计「同时在跑的 run 数」的并发型限额,贴线配置(上限 = 限额值)压不稳:退避让出的位立刻被新 attempt 顶上,agent 侧并发恒在上限,睡醒的重试面对的仍是打满的限额,重试预算在持续饱和下白烧。把值设到限额以下留余量,或改用实验级 `maxConcurrency`——它退避不释放、被限流时真正不加压(见[用例手册 · 用例 4](concurrency.md#4-agent-老撞限额给这个实验单独降速))。
- 收并发不改变结果排序(仍按发现顺序输出)与派发优先级(瓶颈优先,见 [Runner · 派发顺序](../../../runner.md#派发顺序瓶颈优先追求最小总墙钟时间))。
- 等待实验级 `setup` 的 attempt 不持有、不预留并发位,计数里保持 `queued`——慢启动的隧道不会让「0 running · N queued 长时间不动」变成并发配置问题(见 [CLI · 实验级钩子的显示](../cli.md#实验级钩子的显示))。
- 并发上限管的是资源占用,不是花费上限;封顶花钱用 [`--budget`](budget.md)。
- 与 [`--reuse-sandbox`](../../sandbox/serial-reuse.md) 组合是用法错误,创建沙箱前报错——复用是单热道串行,并发不是它的输入面,不静默钉回 1。

## 相关阅读

- [Runner · 调度:有界并发](../../../runner.md#调度有界并发) —— 解析链、provider 推荐值与两级闸的单源。
- [CLI · 运行中的 live 面板](../cli.md#运行中的-live-面板) —— 计数行与 ACTIVE 区的完整体裁。
