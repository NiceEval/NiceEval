# 安装基准

`bench/` 是仓库里的普通 NiceEval 项目。每个探测是一条 Eval，每个 Experiment 声明要比较的 Sandbox Provider 与 Agent Adapter。样本由 `niceeval exp` 执行，结果写入该项目的 Record。

## 运行探测

探测在 Agent 安装后调用版本或可用性命令。一次运行默认取 10 个样本，用于区分冷启动与后续执行。付费 Provider 或模型调用须先取得授权。

以下是目标用法。实验名和目录由基准项目提供。

```sh
cd bench
niceeval exp install/docker --attempts 10 --max-concurrency 1 --rerun all --json
niceeval exp install/e2b --attempts 10 --max-concurrency 1 --rerun all --json
niceeval compare <基线-Run-ID> -- <对照-Run-ID> --json
```

从每次运行的 receipt 取 Run ID，比较两个已完成的 Run。具体阶段用 `niceeval show @<locator> timing --json` 读取，以[阶段耗时口径](../../observability.md#阶段耗时)解释。

## 比较纪律

- 一轮只改变一个变量。记录 Provider、Adapter 版本、机器、并发度和两侧的 Run ID。
- 分别报告首个样本、后续样本的 median 与 min/max，同时保留分母。
- 分别统计 Provider 创建失败、Agent 安装失败和探测命令失败。
- 在采样前确定阈值和噪声判据。比较结果为 regression、improvement 或 inconclusive；噪声掩盖差异或样本不足时保留 inconclusive。
- 对照与新版本都消耗真实资源。采样前确定运行次数与费用上限。
