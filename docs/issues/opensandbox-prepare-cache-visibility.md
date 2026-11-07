# OpenSandbox 准备缓存是否命中、334 秒花在哪，公开 timing 与 receipt 都看不出

## 观察与期望
同一个 Eval 在 OpenSandbox 上连续运行，`sandbox.prepare` 一次用了 457 秒，后一次只用了 49 秒。公开结果给不出原因，看不出前一次是缓存未命中、在建缓存，还是别的步骤慢：

- 慢的那次，`attempt.timing` 中 `sandbox.prepare` 从 14.7 s 开始，持续 457.4 s。它的第一个子 prepare 在 43.3 s 结束，下一个子 prepare 在 377.2 s 才开始，中间约 334 秒没有任何子 activity。前 64 条已全部读出，没有被省略。
- `exp --json` receipt 的 `summary.beforeCaches` 三次都是 `{"total":0,"hit":0,"prepared":0,"failed":0}`，包括命中缓存、49 秒就完成准备的那次。所以公开入口显示不出 Provider 的准备缓存是否命中。
- `show @<locator> --execution` 里搜不到 snapshot、cache 或 restore 相关的记录。

期望：
1. timing 把 prepare 内的耗时归到具体 activity，例如缓存恢复、缓存构建或快照提交；
2. receipt 或 Attempt 概览如实报告 Provider 准备缓存的命中、构建和失败。这样「这次为什么慢」可以从公开入口回答，不需要去查 Kubernetes。

## 公开入口证据
- 项目 NiceEval-Eval，Experiment `harness/canary`，Eval `harness/terminal-bench/log-summary-repair`。
- 慢：Run `766c78b2-804a-4dc1-b911-c3339cf2040d`，Attempt `@1969WJK61TX2T`。`sandbox.prepare` 共 457,434 ms，子 activity 依次为 14,349 ms（28.9 s 起）、86,089 ms（377.2 s 起，含两条 `set` 命令 65.6 s、20.5 s）、7,008 ms（463.3 s 起）。
- 快：同一 Experiment 与 Eval 的下一次运行 `@1DY3570XGBZ7X`，`sandbox.prepare` 49 s。同日 `harness/v0.19.0` 的 `@1SSJ3DDMB46VY` 为 105 s。
- 读取方式：`niceeval query run`（`niceeval.query/v3`，`attempt.timing`），`niceeval show @<locator> --timing` / `--execution`，以及 `exp --json` 最后一行 receipt。

## 影响
NiceEval-Eval 每个 Attempt 都要准备 inner Docker runtime 与候选安装，冷准备和热准备相差约 400 秒。看不出是否命中，就判断不了是缓存失效（身份变化或快照过期）还是 Provider 慢，也无法据实向用户报告成本。上一轮验收（2026-10-26）只能靠 Kubernetes workload 镜像与快照清单旁证命中，不在 NiceEval 的公开证据边界内。

## 环境与来源
2026-10-28，Linux；外层通过 `pnpm dev:link` 消费本地核心 `0.0.0-development`（HEAD 6703bfea5，工作树有其他任务的未提交改动），OpenSandbox SDK 1.1.1、Kata 单并发；内层候选 0.19.1-canary.104。
