# Agent-as-Judge —— CLI

CLI 在计划阶段显示裁判 Agent 的 capability、profile 和 workspace snapshot 授权。运行时显示独立裁判 Session 的进度，不把它混入被测 Agent 的 Turn。

Pass 读取面显示 Execution、Verdict、Agent Judge condition、measurement 和 rationale。Score 读取面显示 Execution、Score、`recorded` 或贡献分数、局部 condition 和 stop cause。

不能读取 Decision 时，机器输出和人读界面显示结构化 Issue，不把错误显示成 mismatch 或 `0`。
