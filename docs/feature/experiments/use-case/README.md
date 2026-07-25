# Experiments 用例手册

规则难懂的地方来这里按场景查。两种体裁并存,契约单源始终在 [CLI](../cli.md)、[Library](../library.md) 与 [Runner](../../../runner.md),用例只做搭配与叙事,不复制契约定义:

- **输入面全流程**:一篇讲一个 CLI 输入的真实用例——用户遇到什么问题、带上这个输入之后从命令到结束反馈的完整路径、边界与何时改用别的模式。
- **主题速查手册**:一个主题一篇、篇内多用例,每个用例 = 具体场景 + 照抄的搭配代码 + 「你会看到」的可观察行为;主文档在对应段落引用手册,不复述用例。

## 主题速查手册

- [并发怎么配](concurrency.md) —— 要不要 `maxConcurrency`?配几?串行 / 降速 / 严格重试 / 快慢混跑,9 个场景。
- [环境预置与收尾怎么放](lifecycle.md) —— 装依赖、起服务、载入状态写在哪层 setup;常见错位清单。
- [flags / labels / facts 放哪个](flags-labels-facts.md) —— 你写下的条件、报表坐标、跑起来才有的观测,三个家。
- [选哪些 eval 来跑](eval-selection.md) —— `evals` 声明、tag 谓词、CLI 收窄、混型报错。

## 位置参数(选择器)

- [选择器 + `--dry`:几十个实验里只跑要跑的,先看清计划再花钱](selector-narrowing.md)

## 输出形态(`--json`)

- [`--json`(AI 循环):让 coding agent 驱动「跑→读失败→改→重跑」](json-agent-loop.md)
- [CI 门禁:退出码、JUnit 与人读日志](json-ci-gate.md)

## 调度

- [`--budget`:一批长跑实验,给烧钱装安全网](budget.md)
- [`--max-concurrency`:本地资源耗尽或 provider 限流,收并发](max-concurrency.md)

## 判定

- [`--early-exit`:只想知道能不能做到,不为通过率分布跑满](early-exit.md)

## 缓存

- [改什么会作废缓存](cache-invalidation.md) —— 改 eval / flags / 超时 / 沙箱各会不会重跑,不想重跑怎么办,11 个场景。
- [`--rerun`:上一轮的结果哪些还算数](rerun.md) —— 只复验失败项 / 全量重验两档,以及各自的边界。

## 对比怎么计分

一个实验选中的 eval 必须同一题型:通过制实验(`defineEval`)读通过率,一题一分、`runs > 1` 按通过率折叠;计分制实验(`defineScoreEval`)读总分,题内叠加挣分;混型选择是启动期配置错误。「死在哪层」「部分完成」「质量差」各有下钻读法,契约见[计分粒度](../score-points.md)。
