# `--reuse-sandbox`:同一题重复多次看稳定性,安装只付一次

## 解决什么问题

一条 eval 时过时不过,想在本地重复跑若干次看通过率分布,再决定是修断言还是修 agent。`runs: 5` 在默认模式下是 5 套全新沙箱、5 次冷启动;本地资源有限、并发开不大时,大部分墙钟时间花在重复安装同一套环境上。

## 全流程

1. 实验配置里已有(或临时改出)重复次数:

   ```ts
   export default defineExperiment({
     // …
     runs: 5,
   });
   ```

2. 收窄到这一题,带 flag 跑:

   ```bash
   niceeval exp memory/commit0 onboarding/tool-first --reuse-sandbox
   ```

3. 安装只发生一次;5 个 attempt 在同一条热道上**串行**依次跑,每次开跑前 reset 回温基线([契约](../serial-reuse.md#与留存缓存重试的组合)),互相之间 workdir 级干净。
4. [首过即停](../../../concepts.md)语义不变:配了 `earlyExit: true` 且某次通过,剩余重复照常省略;默认跑满拿完整分布。
5. 跑完 `niceeval show` 看逐 attempt 判定分布,定位是断言太脆还是 agent 不稳。

## 边界

- **分布只当本地参考。** 5 次跑在同一实例里,workdir 之外的状态(agent cache、`$HOME`)会跨次累积,与 CI 的独立同分布假设不同;要出可引用的通过率,用默认模式跑。
- **与缓存双向绝缘。** 这 5 条结果不会让下一次正式 run 被指纹跳过;反向也一样,上一轮的终态 attempt 不携带进来,分布全部来自本次热道上的真跑([契约](../serial-reuse.md#与留存缓存重试的组合))。

## 相关阅读

- [串行复用](../serial-reuse.md) —— `runs > 1` 串行与缓存排除的契约。
- [Runner](../../../runner.md) —— 首过即停与派发语义。
