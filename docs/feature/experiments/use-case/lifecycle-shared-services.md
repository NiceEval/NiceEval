# 启动实验级共享服务

一个 mock API、临时数据库或隧道只需要服务本次 Experiment 时，在 experiment `before` 中启动，通过模块闭包交给后续 prepare command 或 Agent 工厂，并在 `after` 中关闭。

运行后才知道的 URL 不写进 `flags`；需要审计时，只有 NiceEval 已发布且语义匹配的 typed collector 或 Adapter 能力才能把它写入固定事实；没有 collector 的值不自动持久化或查询（见[运行时观测](observations-report-runtime.md)）。

实验级 Hook 整场只运行一次。
资源需要跨 Run 常驻时，改用[外部编排](lifecycle-external-long-lived-resource.md)。
