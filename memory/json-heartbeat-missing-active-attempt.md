# JSON 心跳缺少正在执行的 Attempt 身份与阶段

JSON progress 心跳目前只给计数，无法确定长时间运行中的 Eval、Attempt 与阶段。Renderer 已持有这些临时状态，却没有投影到机器事件。

采用 experiments/cli.md 的有界 active 快照契约：按身份排序，最多 64 条，标识被省略数量，仅含身份、阶段和 elapsedMs，不输出 detail 或命令正文。公开 CLI 等待中的确定性 Eval 验证心跳与正常收尾。此项是新增机器观测能力，不声称旧计数协议违反此前契约。
