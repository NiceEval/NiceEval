# Sandbox —— CLI 用例

本目录是 Sandbox 相关 CLI flag 的用例文档(体裁约定见[功能文档](../../README.md)):一篇讲一个真实用例的全流程——用户遇到什么问题、带上这个 flag 之后从命令到结束反馈的完整路径、边界与何时改用别的模式。契约单源在 [CLI](../cli.md) 与[串行复用](../serial-reuse.md),这里只做叙事串联,不复制契约定义。

## `--reuse-sandbox`(串行复用)

- [本地冒烟一批 eval:N 次冷启动折成一次](reuse-sandbox-batch-smoke.md)
- [同一题重复多次看稳定性:安装只付一次](reuse-sandbox-stability-runs.md)
- [批次不同基线:跟着报错缩小选择](reuse-sandbox-heterogeneous-batch.md)
- [怎么写 eval 才能安全进热道](reuse-sandbox-authoring.md)

## `--keep-sandbox`(留存现场)

- [环境类 errored:进现场手动重跑 setup](keep-sandbox-env-errored.md)
- [看 agent 在 workdir 之外做了什么](keep-sandbox-outside-workdir.md)
- [把分钟级复现压到秒级:在现场反复验证假设](keep-sandbox-hypothesis-loop.md)
