# Multi-Agent Evals —— CLI 预期反馈

不新增 CLI 命令或 flag。

`--agent` 只换主被测。对手 agent(场景 B 的 `t.newSession({ agent })`)在 eval 文件里点名,是场景的一部分,地位等同 fixture,不进 `--agent` 或 experiments 的 agent 矩阵;要对比不同对手,写两条 eval 或用 `flags`。
