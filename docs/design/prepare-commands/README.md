# 内置 prepare 命令:固定生命周期下的具体化声明与复用成本

**相关文档**:[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md) ·
[PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md)

[Sandbox 模型](../environment-model/DECISION.md)已经固定生命周期:每条 Attempt 按 template owner 顺序重新执行两层 `prepare()` 命令,昂贵动作靠真实检查快速命中。
频次与顺序不是本主题的问题;本主题裁决的是**作者怎样具体、便宜地满足这条固定 cadence**。

现状把三件事都留给作者惯用法:昂贵命令的探测写法(`command -v x || install`)、复用周期内的缓存位置(workdir 外目录)、以及哪些命令会在复用下命中的预判。
`shell()` 自带纯数据 identity,却不自带检查语义;写错惯用法的症状是复用不省钱或每题重付网络,且只有跑起来才发现。

本主题回答三个问题:

1. 复用周期内每条命令的预期成本(检查命中还是全额重新执行)怎样在计划面可见。
2. 常见昂贵动作(源码 checkout、工具安装)的检查与缓存,归作者惯用法还是官方内置命令。
3. 官方内置命令 与 memory 旧裁决「不配官方 fixture 装载 API」的关系怎样处理。

三个候选:

- [PLAN-1](PLAN-1/README.md):官方内置命令库(`checkout` / `installTool`)加 `--dry` 复用成本视图;全部建在 `prepare()` 之上。
- [PLAN-2](PLAN-2/README.md):给 SandboxCommand 增加意图分类字段,框架按类别推导缓存与展示。
- [PLAN-3](PLAN-3/README.md):零新 API,惯用法进文档与用例。
