# CLI 无法在一次 Invocation 中精确选择离散实验

Experiment CLI 只接受单个路径前缀；离散 ID 集合无法保持精确选择，同时共享一次 Invocation 的预算和全局并发。共同前缀会扩大选择，多个 CLI 进程则各自持有 Invocation 额度。

采用可重复的 --experiment 精确 ID 选项及 Host experimentIds 输入。集合去重，任一缺失 ID 阻断整个计划；后续 Eval 前缀仍只能收窄选中的实验。

公开 CLI 验收选择两个离散实验并重复一个 ID，确认只产生两个 Run、start 声明同一全局并发和精确的 Eval 集合；不存在的精确 ID 不得退回前缀匹配。
