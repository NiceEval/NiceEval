# `--max-concurrency` 压不住 agent 侧 per-user 并发限额:退避让位把空位喂给新 attempt

## 现象

`niceeval exp compare/bub --max-concurrency 3`(bub-gpt-5.6-luna 单配置),PLAN 面板报 `concurrency 3`,但 live 面板 ACTIVE 区同时出现 5–6 行 `running`(其中若干行是 `turn retry n/4 (rate_limit) — waiting`),读起来像并发上限没生效。同场两个 attempt 的 send 4 次尝试全部撞 bub 服务端「Concurrency limit exceeded for user, please retry later」,重试预算耗尽后终态 failed。2026-07-24 真机复现。

## 根因

两层叠加,面板部分不是 bug,失败部分是设计与限额类型的错配:

1. **面板 running > 上限是契约行为**:按 [experiment-gate-tenure-ruling](experiment-gate-tenure-ruling.md)(2026-07-23),全局并发位在 turn 退避睡眠期间让位、睡醒重新排队(`docs/feature/error-classification/architecture.md#退避与槽位`)。ACTIVE 的 `running` 行 = 持位执行者 + 退避睡眠者,任一瞬间真正持位并发 ≤ 上限。超出上限的行数恰等于正在退避的 attempt 数。
2. **对 per-user 并发限额,让位机制自我拆台**:退避 attempt 让出的全局位立刻被派发给新 attempt,新 attempt 起新的 agent run——agent 服务端看到的本用户并发恒钉在上限,从不因退避而下降。睡醒的 attempt 重新拿位再发时面对的仍是打满的限额,send 级 4 次预算在持续饱和下白烧。`--max-concurrency` 设成与服务端限额同值(3 对 3)是贴线配置,服务端计数稍有滞后(上一个 run 刚退出仍被计数)就间歇拒绝。对「每分钟请求数」型限流,让位降压有效;对「并发 run 数」型限额,让位只是换人占坑,总压力不变。

## 修法(已修,docs;调度机制无 bug 不改)

用户裁定(2026-07-24):全局让位是定稿设计(experiment-gate-tenure-ruling 已论证过「全局位也不释放」方案并否决),修的是 docs 缺口——限额类型路由与面板读法。落点:

- `docs/runner.md#调度有界并发`:全局位 bullet 补「让出的名额立刻派给排队者,对外压力不因退避下降,『被限流时不加压』是实验级闸的语义」;解析链段把「agent API 限速自己用 `--max-concurrency` 压」改为按限额类型路由(速率型收总吞吐有效;并发型贴线压不稳,留余量或用实验级闸)。
- `docs/feature/error-classification/architecture.md#退避与槽位`:槽位行补「全局位保吞吐不保限流降压、running 可超上限、要不加压用实验级闸」。
- `docs/feature/experiments/use-case/max-concurrency.md`:面板读法补「`running` 计进行中 attempt 不是持位数,退避睡眠者计 running 不持位,超出行数 = 退避行数」;边界补并发型限额贴线配置条目。
- `docs/feature/experiments/use-case/concurrency.md`:路由表加「并发型限额重试一直撞 → 用例 4」一行;用例 4 场景扩到单实验也该用实验级闸;用例 8 改为按限额类型分流。

用户侧规避(即本次的正确配置):实验文件里声明 `maxConcurrency: 3`,或全局降档 `--max-concurrency 2` 留余量(已完成终态按指纹携带,降档重跑只补挂掉的)。
