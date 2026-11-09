# 检查响应耗时与分位数

## 用户目标

应用作者要检查一次动作的响应耗时和一组间隔的 90% 分位数，并在没有观测时保留原因。

## 起始状态

应用 Adapter `metrics` 暴露 `observe()`，返回应用真实采集的 `latencyMs: number | null` 与 `intervalsMs: readonly number[]`。
已有 Experiment `metrics` 选择同一个 Adapter，`metrics.ts` 导出它。
以下代码只展示评估写法；输入表是示例观测，输出均为预期输出，未运行应用。

## 完整路径

1. 在 Eval 目录保存 `response-metrics.ts`，将一次观测包装为数值材料，并检查样本分位数。 {#author}

   ```ts
   import { atMost, measured, ms, quantile } from "niceeval/expect";
   import { metrics } from "../metrics.ts";

   export default metrics.defineEval({
     description: "响应与动作间隔满足时限",
     async test(t) {
       const observation = await t.observe();
       t.check(
         measured(observation.latencyMs, { unavailable: "no-actions" }),
         atMost(1200),
       ).gate().label("响应耗时");

       t.check(
         quantile(observation.intervalsMs.map((value) => ms(value)), 0.9),
         atMost(ms(3000)),
       ).gate().label("动作间隔 P90");
     },
   });
   ```

   预期输出：第一项按应用提供的毫秒数比较，第二项以 `ms` 包装样本和阈值。
   应用保留没有动作的事实，不把 `null` 补成零。

2. 执行这条 Eval，检查正式观测或缺失原因。 {#run}

   ```sh
   niceeval exp metrics response-metrics
   ```

   | 给定观测 | 预期输出 |
   |---|---|
   | latency 为 1000，间隔为 `[1000, 2000, 3000]` | 默认 linear 算出 P90 为 2800 ms，两项匹配，Attempt 为 `passed`。 |
   | latency 为 1500，间隔同上 | 响应耗时超过上限，Attempt 为 `failed`。 |
   | latency 为 null，间隔同上 | 第一项 unavailable，保留 `no-actions`；不伪造零耗时。 |
   | latency 为 1000，间隔为 `[]` | 分位数 unavailable，保留 `no-samples`；不报告零间隔。 |

## 结果

响应和间隔各有独立的检查结果，未知材料仍带可复核的原因。
检查使用应用的正式观测，不用固定示例数组冒充真实运行结果。

## 相关契约

- [观测数值与分位数](../library/README.md#观测数值与分位数)：数值材料、未知原因与 linear 算法。
- [数值单位](../library/README.md#数值单位)：`ms` 与同单位阈值。
- [原生 Adapter](../../adapters/library/writing-an-adapter.md)：绑定应用方法与 Eval。
- [Experiment CLI](../../experiments/cli/README.md#命令)：执行入口。
