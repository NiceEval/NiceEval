# Experiments 用例手册

规则难懂的地方来这里按场景查。
一个目录对应一个 flag、API 组或功能主题；目录 README 只帮助选择，叶子文档一篇讲一个用户目标的完整路径。
契约单源始终在 [CLI](../cli.md)、[Library](../library.md) 与 [Runner](../../../runner.md)，用例只做搭配与叙事，不复制定义。

## Library 与配置主题

- [并发用例](并发/) —— 独立执行、共享状态、固定顺序、服务限流、严格重试与多 Invocation 协作。
- [生命周期用例](生命周期/) —— 装依赖、起服务、载入状态分别写在哪层 setup。
- [实验值归属](实验值归属/) —— flags、labels 与运行时观测分别放哪里。
- [选择 Eval](选择评测/) —— `evals` 声明、tag 谓词、CLI 收窄与混型读数。

## 位置参数(选择器)

- [选择器 + `--dry`:几十个实验里只跑要跑的,先看清计划再花钱](选择评测/预览并收窄.md)

## 输出形态(`--json`)

- [`--json` 用例](机器输出/) —— AI 修复循环与 CI 门禁分开说明。

## 调度

- [`--budget`:一批长跑实验,给烧钱装安全网](预算上限.md)
- [`--max-concurrency`:本地资源耗尽或 provider 限流,收并发](并发/限制全局并发.md)

## 判定

- [`--early-exit`:只想知道能不能做到,不为通过率分布跑满](首过即停.md)

## 缓存

- [缓存与 Attempt 采用用例](缓存与沿用/) —— 不同改动是否作废已有 Attempt，以及何时必须主动重跑。
- [`--rerun` 用例](重新运行/) —— 只复验失败项与全量重验。

## 对比怎么计分

一个实验可以同时选择两种题型:通过制 eval(`defineEval`)读 Verdict 的通过率;计分制 eval(`defineScoreEval`)读
Score Attachment 的 earned score。两种题型的每个 Attempt 都有四态 Verdict；计分制还显示 complete、partial
或 unavailable。混型时两种主读数分列、不相加。
「死在哪层」「部分完成」「质量差」各有下钻读法,契约见[计分粒度](../../assertions/library/score-points.md)。
